using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using AccesoDatos.Context;
using AccesoDatos.Models;
using webapi.Dtos;
using webapi.Core;

namespace webapi.Services
{
    public class TelemetriaService : ITelemetriaService
    {
        private readonly PrevencionAccidentesBusesContext _context;
        private readonly IPushNotificationService _pushNotifications;
        private static readonly ConcurrentDictionary<int, SemaphoreSlim> PilotWrites = new();

        private async Task<ViajeDiario> ResolveTelemetryTripAsync(int pilotId, IReadOnlyList<CrearTelemetriaDto> readings)
        {
            var tripIds = readings.Select(item => item.IdViaje).Distinct().ToArray();
            if (tripIds.Length != 1) throw new InvalidOperationException("Cada lote debe pertenecer a un solo viaje.");
            var tripId = tripIds[0];
            var trip = await _context.ViajesDiarios
                .Include(v => v.IdUsuarioNavigation).Include(v => v.IdAutobusNavigation).Include(v => v.IdRutaNavigation)
                .FirstOrDefaultAsync(v => v.IdUsuario == pilotId && (tripId.HasValue ? v.IdViaje == tripId : v.EstadoViaje == "En Curso"));
            if (trip == null) throw new InvalidOperationException("El viaje no pertenece al piloto o ya no está disponible. Se conservan las posiciones para revisión.");
            if (tripId.HasValue && readings.Any(item => {
                var time = NormalizeTimestampUtc(item.FechaHoraDispositivo);
                return time < NormalizeTimestampUtc(trip.FechaInicio).AddMinutes(-2)
                    || (trip.FechaFin.HasValue && time > NormalizeTimestampUtc(trip.FechaFin.Value).AddMinutes(2));
            })) throw new InvalidOperationException("Hay posiciones fuera del período del viaje. Se requiere revisar la fecha del dispositivo.");
            return trip;
        }

        public TelemetriaService(
            PrevencionAccidentesBusesContext context,
            IPushNotificationService? pushNotifications = null)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
            _pushNotifications = pushNotifications ?? NullPushNotificationService.Instance;
        }

        public Task<int> RegistrarTelemetriaAsync(int idPiloto, CrearTelemetriaDto dto) =>
            RegistrarTelemetriaBatchAsync(idPiloto, new[] { dto });

        public async Task<TelemetryBatchReceipt> RegistrarDeliveryAsync(int idPiloto, IReadOnlyList<CrearTelemetriaDto> dtos)
        {
            var receipts = new List<TelemetryReceipt>();
            var ids = dtos.Select(x => x.IdViaje).Distinct().ToArray();
            var trips = await _context.ViajesDiarios.AsNoTracking().Where(x => x.IdUsuario == idPiloto && ids.Contains(x.IdViaje)).ToListAsync();
            var valid = new List<CrearTelemetriaDto>();
            foreach (var dto in dtos) {
                try {
                    var time = ValidateDeviceTimestamp(dto.FechaHoraDispositivo);
                    var trip = trips.SingleOrDefault(x => x.IdViaje == dto.IdViaje)
                        ?? throw new InvalidOperationException("El viaje no pertenece al piloto.");
                    if (time < NormalizeTimestampUtc(trip.FechaInicio).AddMinutes(-2) || (trip.FechaFin.HasValue && time > NormalizeTimestampUtc(trip.FechaFin.Value).AddMinutes(2)))
                        throw new InvalidOperationException("La posición está fuera del período del viaje.");
                    TrackingSourcePolicy.Validate(trip, dto.IdFuente, time, DateTime.UtcNow);
                    valid.Add(dto);
                } catch (InvalidOperationException ex) { receipts.Add(new(dto.IdLectura!, "rechazada", "REVISAR_LECTURA", ex.Message)); }
            }
            async Task Deliver(IReadOnlyList<CrearTelemetriaDto> items) {
                try {
                    var count = await RegistrarTelemetriaBatchAsync(idPiloto, items);
                    receipts.AddRange(items.Select(x => new TelemetryReceipt(x.IdLectura!, count == 0 ? "duplicada" : "aceptada")));
                } catch (InvalidOperationException ex) {
                    _context.ChangeTracker.Clear();
                    if (items.Count == 1) receipts.Add(new(items[0].IdLectura!, "rechazada", "CONFLICTO_LECTURA", ex.Message));
                    else { var middle = items.Count / 2; await Deliver(items.Take(middle).ToArray()); await Deliver(items.Skip(middle).ToArray()); }
                }
            }
            foreach (var group in valid.GroupBy(x => x.IdViaje)) await Deliver(group.ToArray());
            return new TelemetryBatchReceipt(receipts);
        }

        public async Task<int> RegistrarTelemetriaBatchAsync(int idPiloto, IEnumerable<CrearTelemetriaDto> dtos)
        {
            var gate = PilotWrites.GetOrAdd(idPiloto, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync();
            var attempt = 0;
            try { return await _context.Database.CreateExecutionStrategy().ExecuteAsync(() => {
                if (attempt++ > 0) _context.ChangeTracker.Clear();
                return RegistrarBatchCoreAsync(idPiloto, dtos);
            }); }
            finally { gate.Release(); }
        }

        private async Task<int> RegistrarBatchCoreAsync(int idPiloto, IEnumerable<CrearTelemetriaDto> dtos)
        {
            if (dtos == null) return 0;
            await using var transaction = await _context.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);
            await TripLifecycle.LockAsync(_context, $"telemetry:{idPiloto}");

            var readings = dtos.ToList();
            foreach (var dto in readings) {
                dto.Latitud = Math.Round(dto.Latitud, 8, MidpointRounding.AwayFromZero);
                dto.Longitud = Math.Round(dto.Longitud, 8, MidpointRounding.AwayFromZero);
                dto.VelocidadKmh = Math.Round(dto.VelocidadKmh, 2, MidpointRounding.AwayFromZero);
            }
            var orderedDtos = readings
                .Select(dto => new { Dto = dto, TimestampUtc = ValidateDeviceTimestamp(dto.FechaHoraDispositivo) })
                .OrderBy(item => item.TimestampUtc)
                .DistinctBy(item => item.Dto.IdLectura ?? item.TimestampUtc.Ticks.ToString())
                .ToList();
            if (orderedDtos.Count == 0) return 0;

            var requestedTrip = readings.Select(x => x.IdViaje).Distinct().ToArray();
            if (requestedTrip.Length == 1 && requestedTrip[0].HasValue) await TripLifecycle.LockAsync(_context, $"trip:{requestedTrip[0]}");
            var viaje = await ResolveTelemetryTripAsync(idPiloto, readings);
            if (_context.Database.IsSqlServer()) await _context.Entry(viaje).ReloadAsync();
            foreach (var item in orderedDtos) TrackingSourcePolicy.Validate(viaje, item.Dto.IdFuente, item.TimestampUtc, DateTime.UtcNow);
            foreach (var item in orderedDtos)
                if (item.Dto.IdLectura == null || item.Dto.IdLectura.StartsWith("legacy:")) item.Dto.IdLectura = $"legacy:{item.TimestampUtc.Ticks}";
            var ids = orderedDtos.Select(x => x.Dto.IdLectura!).ToArray();
            var storedReadings = await _context.TelemetriaIots.AsNoTracking()
                .Where(x => x.IdViaje == viaje.IdViaje && ids.Contains(x.IdLectura!)).ToListAsync();
            foreach (var stored in storedReadings)
            {
                var replay = orderedDtos.First(x => x.Dto.IdLectura == stored.IdLectura);
                if (!stored.IdLectura!.StartsWith("legacy:") && (stored.HashLectura != null ? stored.HashLectura != Fingerprint(replay.Dto, viaje.IdViaje, replay.TimestampUtc)
                    : stored.Latitud != replay.Dto.Latitud || stored.Longitud != replay.Dto.Longitud
                    || stored.VelocidadKmh != replay.Dto.VelocidadKmh || stored.FechaHoraDispositivo != replay.TimestampUtc))
                    throw new InvalidOperationException("El identificador de lectura ya existe con otros datos.");
            }
            orderedDtos = orderedDtos.Where(x => !storedReadings.Any(y => y.IdLectura == x.Dto.IdLectura)).ToList();
            // Transition from SQL datetime: recover an unacknowledged legacy row
            // using its rounded time AND position/speed, without rewriting history.
            var roundedTimes = orderedDtos.Select(x => new System.Data.SqlTypes.SqlDateTime(x.TimestampUtc).Value).Distinct().ToList();
            var legacy = await _context.TelemetriaIots.Where(x => x.IdViaje == viaje.IdViaje && x.IdLectura == null
                && roundedTimes.Contains(x.FechaHoraDispositivo)).ToListAsync();
            orderedDtos = orderedDtos.Where(item => {
                var match = legacy.FirstOrDefault(x => x.IdLectura == null && x.FechaHoraDispositivo == new System.Data.SqlTypes.SqlDateTime(item.TimestampUtc).Value
                    && x.Latitud == item.Dto.Latitud && x.Longitud == item.Dto.Longitud && x.VelocidadKmh == item.Dto.VelocidadKmh);
                if (match == null) return true;
                match.IdLectura = item.Dto.IdLectura;
                match.HashLectura = Fingerprint(item.Dto, viaje.IdViaje, item.TimestampUtc);
                return false;
            }).ToList();
            var times = orderedDtos.Select(item => item.TimestampUtc).ToList();
            var storedTimes = await _context.TelemetriaIots.AsNoTracking()
                .Where(item => item.IdViaje == viaje.IdViaje && times.Contains(item.FechaHoraDispositivo))
                .Select(item => item.FechaHoraDispositivo).ToListAsync();
            var existing = storedTimes.Select(NormalizeTimestampUtc).ToHashSet();
            // Only legacy timestamps are a fallback: two identified readings may share a clock tick.
            orderedDtos = orderedDtos.Where(item => !item.Dto.IdLectura!.StartsWith("legacy:") || !existing.Contains(item.TimestampUtc)).ToList();
            // Installed legacy clients don't identify the journey. Preserve their
            // monotonic contract; explicitly bound archives may fill older gaps.
            if (!readings[0].IdViaje.HasValue)
            {
                var latest = await _context.TelemetriaIots.AsNoTracking().Where(item => item.IdViaje == viaje.IdViaje)
                    .MaxAsync(item => (DateTime?)item.FechaHoraDispositivo);
                if (latest.HasValue) orderedDtos = orderedDtos.Where(item => item.TimestampUtc > NormalizeTimestampUtc(latest.Value)).ToList();
            }
            if (orderedDtos.Count == 0) { await _context.SaveChangesAsync(); await transaction.CommitAsync(); return 0; }
            var active = viaje.EstadoViaje == "En Curso";
            if (active && orderedDtos.Any(x => x.Dto.IdFuente != null && x.Dto.IdFuente == viaje.IdFuenteRastreo
                && x.TimestampUtc >= DateTime.UtcNow.AddSeconds(-30))) viaje.FuenteRastreoExpira = DateTime.UtcNow.AddMinutes(2);

            var alertasCreadas = new List<(AlertaRiesgo alerta, TelemetriaIot telemetria)>();
            var episodes = await _context.AlertaRiesgos.Where(x => x.IdViaje == viaje.IdViaje && x.VersionRegla == "episode-v2").ToListAsync();
            var nowUtc = DateTime.UtcNow;

            TelemetriaIot? lastTelemetry = null;
            foreach (var item in orderedDtos)
            {
                var dto = item.Dto;
                var telemetria = new TelemetriaIot
                {
                    IdLectura = dto.IdLectura,
                    HashLectura = Fingerprint(dto, viaje.IdViaje, item.TimestampUtc),
                    IdFuente = dto.IdFuente,
                    SensoresCalibrados = dto.SensoresCalibrados,
                    PrecisionMetros = dto.PrecisionMetros,
                    IdViaje = viaje.IdViaje,
                    Latitud = dto.Latitud,
                    Longitud = dto.Longitud,
                    VelocidadKmh = dto.VelocidadKmh,
                    AceleracionX = dto.AceleracionX,
                    AceleracionY = dto.AceleracionY,
                    AceleracionZ = dto.AceleracionZ,
                    GiroscopioX = dto.GiroscopioX,
                    GiroscopioY = dto.GiroscopioY,
                    GiroscopioZ = dto.GiroscopioZ,
                    FechaHoraDispositivo = item.TimestampUtc,
                    FechaHoraServidor = nowUtc
                };

                _context.TelemetriaIots.Add(telemetria);
                lastTelemetry = telemetria;

                var nuevasAlertas = BuildRiskAlerts(viaje.IdViaje, telemetria, dto, nowUtc);
                // A continuous episode is one incident, not one per GPS packet.
                foreach (var candidate in nuevasAlertas.ToArray())
                {
                    var connected = episodes.Where(x => x.VersionRegla == "episode-v2" && x.TipoAlerta == candidate.TipoAlerta
                        && x.FechaHora <= candidate.FechaHora.AddSeconds(10)
                        && x.FechaUltimaObservacion >= candidate.FechaHora.AddSeconds(-10)).OrderBy(x => x.IdAlerta == 0).ThenBy(x => x.FechaHora).ToArray();
                    var previous = connected.FirstOrDefault();
                    if (previous == null) { episodes.Add(candidate); continue; }
                    foreach (var merged in connected.Skip(1)) {
                        if (merged.FechaHora < previous.FechaHora) previous.FechaHora = merged.FechaHora;
                        if (merged.FechaUltimaObservacion > previous.FechaUltimaObservacion) previous.FechaUltimaObservacion = merged.FechaUltimaObservacion;
                        if (Math.Abs(merged.ValorRegistrado) > Math.Abs(previous.ValorRegistrado)) {
                            previous.ValorRegistrado = merged.ValorRegistrado;
                            previous.IdTelemetria = merged.IdTelemetria;
                        }
                        merged.VersionRegla = "episode-merged"; // Keep traceability; never delete the source samples.
                    }
                    if (candidate.FechaHora < previous.FechaHora) previous.FechaHora = candidate.FechaHora;
                    if (candidate.FechaHora > previous.FechaUltimaObservacion) previous.FechaUltimaObservacion = candidate.FechaHora;
                    if (Math.Abs(candidate.ValorRegistrado) > Math.Abs(previous.ValorRegistrado)) {
                        previous.ValorRegistrado = candidate.ValorRegistrado;
                        previous.IdTelemetriaNavigation = telemetria;
                    }
                    nuevasAlertas.Remove(candidate);
                }
                _context.AlertaRiesgos.AddRange(nuevasAlertas);
                alertasCreadas.AddRange(nuevasAlertas.Select(alerta => (alerta, telemetria)));
            }

            var lastDto = orderedDtos[^1].Dto;
            // History must not undo a newer live privacy or destination change.
            if (active && lastDto.IdFuente == null && viaje.IdFuenteRastreo == null && lastDto.DestinoLat.HasValue && lastDto.DestinoLng.HasValue && (!viaje.NavegacionActualizada.HasValue
                || orderedDtos[^1].TimestampUtc > NormalizeTimestampUtc(viaje.NavegacionActualizada.Value)))
            {
                viaje.DestinoLatitud = lastDto.DestinoLat;
                viaje.DestinoLongitud = lastDto.DestinoLng;
                viaje.DestinoNombre = NormalizeDestinationName(lastDto.DestinoNombre);
                viaje.NavegacionActualizada = nowUtc;
            }

            await _context.SaveChangesAsync();
            alertasCreadas.RemoveAll(x => x.alerta.VersionRegla != "episode-v2");
            if (alertasCreadas.Count > 0)
            {
                await _pushNotifications.SendToRolesAsync(
                    ["Administrador", "SuperAdministrador", "Supervisor"],
                    "Alertas sincronizadas",
                    $"{viaje.IdAutobusNavigation?.Placa ?? "Unidad"}: {alertasCreadas.Count} evento(s) de riesgo.",
                    new Dictionary<string, string?>
                    {
                        ["eventKey"] = "risk:" + string.Join("-", alertasCreadas.Select(x => x.alerta.IdAlerta)),
                        ["type"] = "risk_alert",
                        ["tab"] = "alerts",
                        ["tripId"] = viaje.IdViaje.ToString()
                    },
                    cancellationToken: CancellationToken.None);
            }

            await transaction.CommitAsync();

            // Tras una reconexión, publicar la posición más reciente del lote.
            if (active && !viaje.ModoPrivacidad && lastTelemetry != null && TrackingSourcePolicy.MayPublish(viaje, lastTelemetry.IdFuente)
                && lastTelemetry.FechaHoraDispositivo >= DateTime.UtcNow.AddSeconds(-30) && lastTelemetry.FechaHoraDispositivo <= DateTime.UtcNow.AddSeconds(5))
            {
                await WebSocketConnectionManager.BroadcastTelemetryAsync(new TelemetriaLiveDto
                {
                    Heading = lastDto.Heading,
                    IdTelemetria = lastTelemetry.IdTelemetria,
                    IdViaje = lastTelemetry.IdViaje,
                    Latitud = lastTelemetry.Latitud,
                    Longitud = lastTelemetry.Longitud,
                    VelocidadKmh = lastTelemetry.VelocidadKmh,
                    AceleracionX = lastTelemetry.AceleracionX,
                    AceleracionY = lastTelemetry.AceleracionY,
                    AceleracionZ = lastTelemetry.AceleracionZ,
                    GiroscopioX = lastTelemetry.GiroscopioX,
                    GiroscopioY = lastTelemetry.GiroscopioY,
                    GiroscopioZ = lastTelemetry.GiroscopioZ,
                    FechaHoraDispositivo = lastTelemetry.FechaHoraDispositivo,
                    PlacaAutobus = viaje.IdAutobusNavigation?.Placa ?? "N/D",
                    NombrePiloto = viaje.IdUsuarioNavigation?.NombreCompleto ?? "Piloto",
                    NombreRuta = viaje.IdRutaNavigation?.NombreRuta ?? viaje.DestinoNombre ?? "Ruta por definir",
                    DestinoLat = viaje.DestinoLatitud,
                    DestinoLng = viaje.DestinoLongitud,
                    DestinoNombre = viaje.DestinoNombre,
                    IsTripActive = active,
                    IsPrivacyMode = false
                }, idPiloto);
            }

            // Emitir alertas acumuladas durante la reconexión
            foreach (var item in alertasCreadas)
            {
                var alertaDto = new AlertaResponseDto
                {
                    IdAlerta = item.alerta.IdAlerta,
                    IdTelemetria = item.telemetria.IdTelemetria,
                    IdViaje = item.alerta.IdViaje,
                    TipoAlerta = item.alerta.TipoAlerta,
                    ValorRegistrado = item.alerta.ValorRegistrado,
                    LimitePermitido = item.alerta.LimitePermitido,
                    FechaHora = item.alerta.FechaHora,
                    FechaRecepcion = item.alerta.FechaRecepcion,
                    FechaUltimaObservacion = item.alerta.FechaUltimaObservacion,
                    VersionRegla = item.alerta.VersionRegla,
                    PlacaAutobus = viaje.IdAutobusNavigation?.Placa ?? "N/D",
                    NombrePiloto = viaje.IdUsuarioNavigation?.NombreCompleto ?? "Piloto",
                    NombreRuta = viaje.IdRutaNavigation?.NombreRuta ?? viaje.DestinoNombre ?? "Ruta por definir"
                };

                await WebSocketConnectionManager.BroadcastAlertAsync(alertaDto, idPiloto);
            }

            return orderedDtos.Count;
        }

        public async Task ActualizarEstadoPilotoAsync(int idPiloto, bool isPrivacyMode)
        {
            var viaje = await _context.ViajesDiarios
                .Include(v => v.IdUsuarioNavigation)
                .Include(v => v.IdAutobusNavigation)
                .Include(v => v.IdRutaNavigation)
                .FirstOrDefaultAsync(v => v.IdUsuario == idPiloto && v.EstadoViaje == "En Curso");

            if (viaje == null)
            {
                throw new InvalidOperationException("No se encontró ningún viaje activo ('En Curso') para el piloto.");
            }

            var latest = await _context.TelemetriaIots
                .AsNoTracking()
                .Where(item => item.IdViaje == viaje.IdViaje)
                .OrderByDescending(item => item.FechaHoraDispositivo)
                .FirstOrDefaultAsync();

            viaje.ModoPrivacidad = isPrivacyMode;
            viaje.NavegacionActualizada = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            await WebSocketConnectionManager.BroadcastTelemetryAsync(new TelemetriaLiveDto
            {
                IdTelemetria = latest?.IdTelemetria ?? 0,
                IdViaje = viaje.IdViaje,
                Latitud = isPrivacyMode ? 0 : latest?.Latitud ?? 0,
                Longitud = isPrivacyMode ? 0 : latest?.Longitud ?? 0,
                VelocidadKmh = isPrivacyMode ? 0 : latest?.VelocidadKmh ?? 0,
                AceleracionX = isPrivacyMode ? null : latest?.AceleracionX,
                AceleracionY = isPrivacyMode ? null : latest?.AceleracionY,
                AceleracionZ = isPrivacyMode ? null : latest?.AceleracionZ,
                GiroscopioX = isPrivacyMode ? null : latest?.GiroscopioX,
                GiroscopioY = isPrivacyMode ? null : latest?.GiroscopioY,
                GiroscopioZ = isPrivacyMode ? null : latest?.GiroscopioZ,
                FechaHoraDispositivo = latest?.FechaHoraDispositivo ?? DateTime.UtcNow,
                PlacaAutobus = viaje.IdAutobusNavigation?.Placa ?? "N/D",
                NombrePiloto = viaje.IdUsuarioNavigation?.NombreCompleto ?? "Piloto",
                NombreRuta = viaje.IdRutaNavigation?.NombreRuta ?? viaje.DestinoNombre ?? "Ruta por definir",
                IsTripActive = true,
                IsPrivacyMode = isPrivacyMode
            }, idPiloto);
        }

        private static List<AlertaRiesgo> BuildRiskAlerts(
            int tripId,
            TelemetriaIot telemetry,
            CrearTelemetriaDto dto,
            DateTime detectedAtUtc)
        {
            var alerts = new List<AlertaRiesgo>();

            void Add(string type, decimal value, decimal limit) => alerts.Add(new AlertaRiesgo
            {
                IdViaje = tripId,
                TipoAlerta = type,
                ValorRegistrado = value,
                LimitePermitido = limit,
                FechaHora = telemetry.FechaHoraDispositivo,
                FechaRecepcion = detectedAtUtc,
                FechaUltimaObservacion = telemetry.FechaHoraDispositivo,
                VersionRegla = "episode-v2",
                IdTelemetriaNavigation = telemetry
            });

            if (dto.VelocidadKmh > 80.0M)
            {
                Add("Exceso de Velocidad", dto.VelocidadKmh, 80.0M);
            }

            // Uncalibrated phone axes are not vehicle axes; GPS-only/background data
            // must never imply that braking/turning was observed and safe.
            if (!dto.SensoresCalibrados) return alerts;
            if (dto.AceleracionY is < -3.0M)
            {
                Add("Frenado Brusco", dto.AceleracionY.Value, -3.0M);
            }
            else if (dto.AceleracionY is > 3.0M)
            {
                Add("Aceleración Peligrosa", dto.AceleracionY.Value, 3.0M);
            }

            if (dto.AceleracionX.HasValue && Math.Abs(dto.AceleracionX.Value) > 3.0M)
            {
                Add("Giro Brusco", dto.AceleracionX.Value, 3.0M);
            }
            else if (dto.GiroscopioZ.HasValue && Math.Abs(dto.GiroscopioZ.Value) > 2.5M)
            {
                Add("Giro Brusco", dto.GiroscopioZ.Value, 2.5M);
            }

            return alerts;
        }

        private static DateTime ValidateDeviceTimestamp(DateTime timestamp)
        {
            if (timestamp == default)
            {
                throw new InvalidOperationException("La fecha y hora del dispositivo es obligatoria.");
            }

            var timestampUtc = timestamp.Kind switch
            {
                DateTimeKind.Utc => timestamp,
                DateTimeKind.Local => timestamp.ToUniversalTime(),
                _ => DateTime.SpecifyKind(timestamp, DateTimeKind.Utc)
            };
            var nowUtc = DateTime.UtcNow;
            if (timestampUtc > nowUtc.AddMinutes(5) || timestampUtc < nowUtc.AddDays(-30))
            {
                throw new InvalidOperationException("La fecha del dispositivo está fuera del rango aceptado.");
            }

            return timestampUtc;
        }

        private static string Fingerprint(CrearTelemetriaDto dto, int tripId, DateTime timestamp)
        {
            string? N(decimal? value) => value?.ToString("G29", System.Globalization.CultureInfo.InvariantCulture);
            var json = System.Text.Json.JsonSerializer.Serialize(new { tripId, time = timestamp.Ticks,
                lat = N(dto.Latitud), lng = N(dto.Longitud), speed = N(dto.VelocidadKmh),
                dto.IdFuente, dto.SensoresCalibrados, accuracy = N(dto.PrecisionMetros), ax = N(dto.AceleracionX), ay = N(dto.AceleracionY), az = N(dto.AceleracionZ),
                gx = N(dto.GiroscopioX), gy = N(dto.GiroscopioY), gz = N(dto.GiroscopioZ), heading = N(dto.Heading),
                destinationLat = N(dto.DestinoLat), destinationLng = N(dto.DestinoLng), destination = NormalizeDestinationName(dto.DestinoNombre) });
            return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(json)));
        }

        private static DateTime NormalizeTimestampUtc(DateTime timestamp) => timestamp.Kind switch
        {
            DateTimeKind.Utc => timestamp,
            DateTimeKind.Local => timestamp.ToUniversalTime(),
            _ => DateTime.SpecifyKind(timestamp, DateTimeKind.Utc)
        };

        private static string? NormalizeDestinationName(string? destinationName)
        {
            var normalized = destinationName?.Trim();
            return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
        }

        public async Task<IEnumerable<AlertaResponseDto>> GetAlertasRecientesAsync(DateTime? inicio = null, DateTime? fin = null)
        {
            return await _context.AlertaRiesgos
                .Where(a => a.VersionRegla != "episode-merged" && (!inicio.HasValue || a.FechaHora >= inicio.Value) && (!fin.HasValue || a.FechaHora < fin.Value))
                .Include(a => a.IdViajeNavigation)
                    .ThenInclude(v => v.IdUsuarioNavigation)
                .Include(a => a.IdViajeNavigation)
                    .ThenInclude(v => v.IdAutobusNavigation)
                .Include(a => a.IdViajeNavigation)
                    .ThenInclude(v => v.IdRutaNavigation)
                .OrderByDescending(a => a.FechaHora)
                .Take(50)
                .Select(a => new AlertaResponseDto
                {
                    IdAlerta = a.IdAlerta,
                    IdTelemetria = a.IdTelemetria,
                    IdViaje = a.IdViaje,
                    TipoAlerta = a.TipoAlerta,
                    ValorRegistrado = a.ValorRegistrado,
                    LimitePermitido = a.LimitePermitido,
                    FechaHora = a.FechaHora,
                    FechaRecepcion = a.FechaRecepcion,
                    FechaUltimaObservacion = a.FechaUltimaObservacion,
                    VersionRegla = a.VersionRegla,
                    PlacaAutobus = a.IdViajeNavigation.PlacaSnapshot ?? a.IdViajeNavigation.IdAutobusNavigation.Placa,
                    NombrePiloto = a.IdViajeNavigation.NombrePilotoSnapshot ?? a.IdViajeNavigation.IdUsuarioNavigation.NombreCompleto,
                    NombreRuta = a.IdViajeNavigation.NombreRutaSnapshot ?? (a.IdViajeNavigation.IdRutaNavigation != null ? a.IdViajeNavigation.IdRutaNavigation.NombreRuta : a.IdViajeNavigation.DestinoNombre ?? "Ruta por definir")
                })
                .ToListAsync();
        }

        public async Task<IEnumerable<AlertaResponseDto>> GetAlertasHistoricasAsync(DateTime? fechaInicio, DateTime? fechaFin, int? idUsuario, string? tipoAlerta)
        {
            var query = _context.AlertaRiesgos
                .Where(a => a.VersionRegla != "episode-merged")
                .Include(a => a.IdViajeNavigation)
                    .ThenInclude(v => v.IdUsuarioNavigation)
                .Include(a => a.IdViajeNavigation)
                    .ThenInclude(v => v.IdAutobusNavigation)
                .Include(a => a.IdViajeNavigation)
                    .ThenInclude(v => v.IdRutaNavigation)
                .AsNoTracking();

            if (fechaInicio.HasValue)
            {
                query = query.Where(a => a.FechaHora >= fechaInicio.Value);
            }

            if (fechaFin.HasValue)
            {
                var finDia = fechaFin.Value.Date.AddDays(1).AddTicks(-1);
                query = query.Where(a => a.FechaHora <= finDia);
            }

            if (idUsuario.HasValue && idUsuario.Value > 0)
            {
                query = query.Where(a => a.IdViajeNavigation.IdUsuario == idUsuario.Value);
            }

            if (!string.IsNullOrEmpty(tipoAlerta))
            {
                query = query.Where(a => a.TipoAlerta == tipoAlerta);
            }

            return await query
                .OrderByDescending(a => a.FechaHora)
                .Select(a => new AlertaResponseDto
                {
                    IdAlerta = a.IdAlerta,
                    IdTelemetria = a.IdTelemetria,
                    IdViaje = a.IdViaje,
                    TipoAlerta = a.TipoAlerta,
                    ValorRegistrado = a.ValorRegistrado,
                    LimitePermitido = a.LimitePermitido,
                    FechaHora = a.FechaHora,
                    PlacaAutobus = a.IdViajeNavigation.PlacaSnapshot ?? a.IdViajeNavigation.IdAutobusNavigation.Placa,
                    FechaRecepcion = a.FechaRecepcion,
                    FechaUltimaObservacion = a.FechaUltimaObservacion,
                    VersionRegla = a.VersionRegla,
                    NombrePiloto = a.IdViajeNavigation.NombrePilotoSnapshot ?? a.IdViajeNavigation.IdUsuarioNavigation.NombreCompleto,
                    NombreRuta = a.IdViajeNavigation.NombreRutaSnapshot ?? (a.IdViajeNavigation.IdRutaNavigation != null ? a.IdViajeNavigation.IdRutaNavigation.NombreRuta : a.IdViajeNavigation.DestinoNombre ?? "Ruta por definir")
                })
                .ToListAsync();
        }

        public async Task<EstadisticasAlertasDto> GetEstadisticasAlertasAsync(DateTime? inicio = null, DateTime? fin = null)
        {
            var query = _context.AlertaRiesgos.AsNoTracking()
                .Where(a => a.VersionRegla != "episode-merged" && (!inicio.HasValue || a.FechaHora >= inicio.Value) && (!fin.HasValue || a.FechaHora < fin.Value));
            var total = await query.CountAsync();

            var tipos = await query
                .GroupBy(alert => alert.TipoAlerta)
                .Select(group => new { Tipo = group.Key, Total = group.Count() })
                .ToDictionaryAsync(item => item.Tipo, item => item.Total);

            foreach (var knownType in new[]
            {
                "Exceso de Velocidad",
                "Frenado Brusco",
                "Aceleración Peligrosa",
                "Giro Brusco"
            })
            {
                tipos.TryAdd(knownType, 0);
            }

            var topPilotos = await query
                .GroupBy(alert => alert.IdViajeNavigation.IdUsuarioNavigation.NombreCompleto)
                .Select(group => new PilotoInfraccionDto
                {
                    NombrePiloto = group.Key,
                    CantidadAlertas = group.Count()
                })
                .OrderByDescending(pilot => pilot.CantidadAlertas)
                .Take(5)
                .ToListAsync();

            return new EstadisticasAlertasDto
            {
                TotalAlertas = total,
                RegistrosHistoricos = await query.CountAsync(a => a.VersionRegla == "legacy"),
                Episodios = await query.CountAsync(a => a.VersionRegla == "episode-v2"),
                AlertasPorTipo = tipos,
                PilotosMasInfracciones = topPilotos
            };
        }
    }
}
