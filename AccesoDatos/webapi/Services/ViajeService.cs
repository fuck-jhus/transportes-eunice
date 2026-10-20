using Microsoft.EntityFrameworkCore;
using AccesoDatos.Context;
using AccesoDatos.Models;
using webapi.Dtos;
using webapi.Core;
using System.Data;

namespace webapi.Services
{
    public class ViajeService : IViajeService
    {
        private readonly PrevencionAccidentesBusesContext _context;
        private readonly IPushNotificationService _pushNotifications;

        public ViajeService(
            PrevencionAccidentesBusesContext context,
            IPushNotificationService? pushNotifications = null)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
            _pushNotifications = pushNotifications ?? NullPushNotificationService.Instance;
        }

        public async Task<IEnumerable<ViajeResponseDto>> GetViajesAsync(string? estado = null, int? idUsuario = null)
        {
            var query = _context.ViajesDiarios
                .Include(v => v.IdUsuarioNavigation)
                .Include(v => v.IdAutobusNavigation)
                .Include(v => v.IdRutaNavigation)
                .AsNoTracking();

            if (!string.IsNullOrEmpty(estado))
            {
                query = query.Where(v => v.EstadoViaje == estado);
            }

            if (idUsuario.HasValue)
            {
                query = query.Where(v => v.IdUsuario == idUsuario.Value);
            }

            return await query.Select(v => new ViajeResponseDto
            {
                IdViaje = v.IdViaje,
                IdUsuario = v.IdUsuario,
                NombrePiloto = v.NombrePilotoSnapshot ?? v.IdUsuarioNavigation.NombreCompleto,
                IdAutobus = v.IdAutobus,
                PlacaAutobus = v.PlacaSnapshot ?? v.IdAutobusNavigation.Placa,
                IdRuta = v.IdRuta,
                NombreRuta = v.NombreRutaSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.NombreRuta : v.DestinoNombre ?? "Ruta por definir"),
                OrigenRuta = v.OrigenSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.Origen : "Punto de salida"),
                DestinoRuta = v.DestinoNombre ?? v.DestinoSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.Destino : "Destino por confirmar"),
                DestinoLatitud = v.DestinoLatitud ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.DestinoLatitud : null),
                DestinoLongitud = v.DestinoLongitud ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.DestinoLongitud : null),
                Version = v.Version,
                RevisionDestino = v.RevisionDestino,
                SnapshotHistoricoEstimado = v.SnapshotHistoricoEstimado,
                DestinoNombre = v.DestinoNombre,
                FechaInicio = v.FechaInicio,
                FechaFin = v.FechaFin,
                EstadoViaje = v.EstadoViaje ?? string.Empty
            }).ToListAsync();
        }

        public async Task<ViajeResponseDto?> GetViajeByIdAsync(int id, int? idUsuario = null)
        {
            var v = await _context.ViajesDiarios
                .Include(v => v.IdUsuarioNavigation)
                .Include(v => v.IdAutobusNavigation)
                .Include(v => v.IdRutaNavigation)
                .AsNoTracking()
                .FirstOrDefaultAsync(v => v.IdViaje == id && (!idUsuario.HasValue || v.IdUsuario == idUsuario.Value));

            if (v == null) return null;

            return new ViajeResponseDto
            {
                IdViaje = v.IdViaje,
                IdUsuario = v.IdUsuario,
                NombrePiloto = v.NombrePilotoSnapshot ?? v.IdUsuarioNavigation.NombreCompleto,
                IdAutobus = v.IdAutobus,
                PlacaAutobus = v.PlacaSnapshot ?? v.IdAutobusNavigation.Placa,
                IdRuta = v.IdRuta,
                NombreRuta = v.NombreRutaSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.NombreRuta : v.DestinoNombre ?? "Ruta por definir"),
                OrigenRuta = v.OrigenSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.Origen : "Punto de salida"),
                DestinoRuta = v.DestinoNombre ?? v.DestinoSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.Destino : "Destino por confirmar"),
                DestinoLatitud = v.DestinoLatitud ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.DestinoLatitud : null),
                DestinoLongitud = v.DestinoLongitud ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.DestinoLongitud : null),
                Version = v.Version,
                RevisionDestino = v.RevisionDestino,
                SnapshotHistoricoEstimado = v.SnapshotHistoricoEstimado,
                DestinoNombre = v.DestinoNombre,
                FechaInicio = v.FechaInicio,
                FechaFin = v.FechaFin,
                EstadoViaje = v.EstadoViaje ?? string.Empty
            };
        }

        public async Task<ViajeResponseDto?> GetViajeActivoPorPilotoAsync(int idPiloto)
        {
            var v = await _context.ViajesDiarios
                .Include(v => v.IdUsuarioNavigation)
                .Include(v => v.IdAutobusNavigation)
                .Include(v => v.IdRutaNavigation)
                .AsNoTracking()
                .FirstOrDefaultAsync(v => v.IdUsuario == idPiloto && v.EstadoViaje == "En Curso");

            if (v == null) return null;

            return new ViajeResponseDto
            {
                IdViaje = v.IdViaje,
                IdUsuario = v.IdUsuario,
                NombrePiloto = v.NombrePilotoSnapshot ?? v.IdUsuarioNavigation.NombreCompleto,
                IdAutobus = v.IdAutobus,
                PlacaAutobus = v.PlacaSnapshot ?? v.IdAutobusNavigation.Placa,
                IdRuta = v.IdRuta,
                NombreRuta = v.NombreRutaSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.NombreRuta : v.DestinoNombre ?? "Ruta por definir"),
                OrigenRuta = v.OrigenSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.Origen : "Punto de salida"),
                DestinoRuta = v.DestinoNombre ?? v.DestinoSnapshot ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.Destino : "Destino por confirmar"),
                DestinoLatitud = v.DestinoLatitud ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.DestinoLatitud : null),
                DestinoLongitud = v.DestinoLongitud ?? (v.IdRutaNavigation != null ? v.IdRutaNavigation.DestinoLongitud : null),
                Version = v.Version,
                RevisionDestino = v.RevisionDestino,
                SnapshotHistoricoEstimado = v.SnapshotHistoricoEstimado,
                DestinoNombre = v.DestinoNombre,
                FechaInicio = v.FechaInicio,
                FechaFin = v.FechaFin,
                EstadoViaje = v.EstadoViaje ?? string.Empty
            };
        }

        public async Task<ViajeResponseDto> CrearViajeAsync(CrearViajeDto dto)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => CrearViajeTransactionalAsync(dto));
        }

        private async Task<ViajeResponseDto> CrearViajeTransactionalAsync(CrearViajeDto dto)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var operationHash = $"v1:{dto.IdUsuario}:{dto.IdAutobus}:{dto.IdRuta}";
            if (dto.IdOperacion.HasValue) {
                if (dto.IdOperacion == Guid.Empty) throw new InvalidOperationException("El identificador de operación no puede estar vacío.");
                await webapi.Core.TripLifecycle.LockAsync(_context, $"dispatch:{dto.IdOperacion}");
                var replay = await _context.ViajesDiarios.AsNoTracking().SingleOrDefaultAsync(x => x.IdOperacion == dto.IdOperacion);
                if (replay != null) {
                    if (replay.HashOperacion != operationHash) throw new webapi.Core.OperationConflictException();
                    return (await GetViajeByIdAsync(replay.IdViaje))!;
                }
            }

            // 1. Validar Piloto
            var piloto = await _context.Usuarios.WithoutDeletedAccounts().FirstOrDefaultAsync(u => u.IdUsuario == dto.IdUsuario);
            if (piloto == null)
            {
                throw new InvalidOperationException("El piloto especificado no existe.");
            }
            if (piloto.TipoRol != "Piloto")
            {
                throw new InvalidOperationException("El usuario seleccionado no es un Piloto.");
            }
            if (piloto.Estado != "Activo")
            {
                throw new InvalidOperationException("El piloto seleccionado está Inactivo.");
            }

            // 2. Concurrencia de Piloto
            bool pilotoEnViaje = await _context.ViajesDiarios
                .AnyAsync(v => v.IdUsuario == dto.IdUsuario && v.EstadoViaje == "En Curso");
            if (pilotoEnViaje)
            {
                throw new InvalidOperationException($"El piloto '{piloto.NombreCompleto}' ya tiene un viaje en curso asignado.");
            }

            // 3. Validar Autobús
            var autobus = await _context.Autobuses.FirstOrDefaultAsync(a => a.IdAutobus == dto.IdAutobus);
            if (autobus == null)
            {
                throw new InvalidOperationException("El autobús especificado no existe.");
            }
            if (autobus.Estado != "Activo")
            {
                throw new InvalidOperationException($"El autobús con placa '{autobus.Placa}' no está disponible (Estado: {autobus.Estado}).");
            }

            // 4. Concurrencia de Autobús
            bool autobusEnViaje = await _context.ViajesDiarios
                .AnyAsync(v => v.IdAutobus == dto.IdAutobus && v.EstadoViaje == "En Curso");
            if (autobusEnViaje)
            {
                throw new InvalidOperationException($"El autobús con placa '{autobus.Placa}' ya está asignado a otro viaje en curso.");
            }

            // 5. La ruta es opcional. Si se recibe una, debe existir.
            Rutum? ruta = null;
            if (dto.IdRuta.HasValue)
            {
                ruta = await _context.Ruta.FirstOrDefaultAsync(r => r.IdRuta == dto.IdRuta.Value);
                if (ruta == null)
                {
                    throw new InvalidOperationException("La ruta especificada no existe.");
                }
            }

            // 6. Crear Viaje
            var nuevoViaje = new ViajeDiario
            {
                IdOperacion = dto.IdOperacion,
                HashOperacion = dto.IdOperacion.HasValue ? operationHash : null,
                IdUsuario = dto.IdUsuario,
                IdAutobus = dto.IdAutobus,
                IdRuta = dto.IdRuta,
                FechaInicio = DateTime.UtcNow,
                EstadoViaje = "En Curso"
            };

            _context.ViajesDiarios.Add(nuevoViaje);
            webapi.Core.TripLifecycle.Snapshot(nuevoViaje, piloto, autobus, ruta);
            await _context.SaveChangesAsync();
            await _pushNotifications.SendToUsersAsync(
                [nuevoViaje.IdUsuario],
                "Nuevo viaje asignado",
                $"{autobus.Placa} · {ruta?.NombreRuta ?? "Ruta por definir"}",
                new Dictionary<string, string?>
                {
                    ["eventKey"] = $"trip-assigned:{nuevoViaje.IdViaje}",
                    ["type"] = "trip_assignment",
                    ["tab"] = "trips",
                    ["tripId"] = nuevoViaje.IdViaje.ToString()
                });
            await transaction.CommitAsync();

            return new ViajeResponseDto
            {
                IdViaje = nuevoViaje.IdViaje,
                IdUsuario = nuevoViaje.IdUsuario,
                NombrePiloto = piloto.NombreCompleto,
                IdAutobus = nuevoViaje.IdAutobus,
                PlacaAutobus = autobus.Placa,
                IdRuta = nuevoViaje.IdRuta,
                NombreRuta = ruta?.NombreRuta ?? "Sin ruta asignada",
                OrigenRuta = ruta?.Origen ?? "Punto de salida",
                DestinoRuta = ruta?.Destino ?? "Destino por confirmar",
                DestinoLatitud = ruta?.DestinoLatitud,
                DestinoLongitud = ruta?.DestinoLongitud,
                FechaInicio = nuevoViaje.FechaInicio,
                FechaFin = nuevoViaje.FechaFin,
                EstadoViaje = nuevoViaje.EstadoViaje
            };
        }

        public async Task<ViajeResponseDto?> GuardarRutaEnViajeAsync(
            int id,
            GuardarRutaViajeDto dto,
            int? idPilotoPropietario = null)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => GuardarRutaEnViajeTransactionalAsync(id, dto, idPilotoPropietario));
        }

        private async Task<ViajeResponseDto?> GuardarRutaEnViajeTransactionalAsync(
            int id,
            GuardarRutaViajeDto dto,
            int? idPilotoPropietario)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var viaje = await _context.ViajesDiarios
                .Include(v => v.IdUsuarioNavigation)
                .Include(v => v.IdAutobusNavigation)
                .Include(v => v.IdRutaNavigation)
                .FirstOrDefaultAsync(v => v.IdViaje == id
                    && v.EstadoViaje == "En Curso"
                    && (!idPilotoPropietario.HasValue || v.IdUsuario == idPilotoPropietario.Value));

            if (viaje == null) return null;

            var normalizedName = dto.NombreRuta.Trim();
            var normalizedOrigin = dto.Origen.Trim();
            var normalizedDestination = dto.Destino.Trim();
            var ruta = await _context.Ruta.FirstOrDefaultAsync(item => item.NombreRuta == normalizedName);

            if (ruta == null)
            {
                ruta = new Rutum
                {
                    NombreRuta = normalizedName,
                    Origen = normalizedOrigin,
                    Destino = normalizedDestination,
                    OrigenLatitud = dto.OrigenLatitud,
                    OrigenLongitud = dto.OrigenLongitud,
                    DestinoLatitud = dto.DestinoLatitud,
                    DestinoLongitud = dto.DestinoLongitud
                };
                _context.Ruta.Add(ruta);
            }
            else if (!string.Equals(ruta.Origen, normalizedOrigin, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(ruta.Destino, normalizedDestination, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"Ya existe una ruta llamada '{normalizedName}' con otro recorrido.");
            }
            else
            {
                // Las rutas creadas manualmente pueden no tener coordenadas. La primera
                // navegación real del piloto completa esos datos sin duplicar el catálogo.
                ruta.OrigenLatitud ??= dto.OrigenLatitud;
                ruta.OrigenLongitud ??= dto.OrigenLongitud;
                ruta.DestinoLatitud ??= dto.DestinoLatitud;
                ruta.DestinoLongitud ??= dto.DestinoLongitud;
            }

            var destinationChanged = viaje.DestinoLatitud != dto.DestinoLatitud
                || viaje.DestinoLongitud != dto.DestinoLongitud || viaje.DestinoNombre != normalizedDestination
                || viaje.IdRuta != ruta.IdRuta;
            viaje.IdRutaNavigation = ruta;
            viaje.DestinoLatitud = dto.DestinoLatitud;
            viaje.DestinoLongitud = dto.DestinoLongitud;
            viaje.DestinoNombre = normalizedDestination;
            viaje.NavegacionActualizada = DateTime.UtcNow;
            if (destinationChanged) viaje.RevisionDestino++;
            viaje.NombreRutaSnapshot = ruta.NombreRuta;
            viaje.OrigenSnapshot = normalizedOrigin;
            viaje.DestinoSnapshot = normalizedDestination;
            if (destinationChanged) await PushOutbox.DestinationChangedAsync(_context, viaje, idPilotoPropietario);

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return new ViajeResponseDto
            {
                IdViaje = viaje.IdViaje,
                IdUsuario = viaje.IdUsuario,
                NombrePiloto = viaje.IdUsuarioNavigation.NombreCompleto,
                IdAutobus = viaje.IdAutobus,
                PlacaAutobus = viaje.IdAutobusNavigation.Placa,
                IdRuta = ruta.IdRuta,
                NombreRuta = ruta.NombreRuta,
                OrigenRuta = ruta.Origen,
                DestinoRuta = ruta.Destino,
                DestinoLatitud = ruta.DestinoLatitud,
                DestinoLongitud = ruta.DestinoLongitud,
                DestinoNombre = viaje.DestinoNombre,
                FechaInicio = viaje.FechaInicio,
                FechaFin = viaje.FechaFin,
                EstadoViaje = viaje.EstadoViaje ?? string.Empty
            };
        }

        public async Task<ViajeResponseDto?> FinalizarViajeAsync(int id, int? idPilotoPropietario = null)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => FinalizarTransactionalAsync(id, idPilotoPropietario));
        }

        private async Task<ViajeResponseDto?> FinalizarTransactionalAsync(int id, int? idPilotoPropietario)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            await webapi.Core.TripLifecycle.LockAsync(_context, $"trip:{id}");
            var viaje = await _context.ViajesDiarios
                .Include(v => v.IdUsuarioNavigation)
                .Include(v => v.IdAutobusNavigation)
                .Include(v => v.IdRutaNavigation)
                .FirstOrDefaultAsync(v => v.IdViaje == id
                    && (!idPilotoPropietario.HasValue || v.IdUsuario == idPilotoPropietario.Value));

            if (viaje == null) return null;

            var changed = await webapi.Core.TripLifecycle.FinishAsync(_context, viaje, "Finalizado por usuario", idPilotoPropietario);

            await _context.SaveChangesAsync();
            // Existing databases store fecha_fin as SQL datetime. Return the
            // persisted precision on the first response, as on later retries.
            if (changed && _context.Database.IsRelational())
                await _context.Entry(viaje).ReloadAsync();
            await transaction.CommitAsync();

            var plate = viaje.IdAutobusNavigation?.Placa ?? "N/D";
            var pilotName = viaje.IdUsuarioNavigation?.NombreCompleto ?? "Piloto";

            if (changed) await webapi.Core.WebSocketConnectionManager.BroadcastPilotOfflineAsync(
                viaje.IdUsuario,
                plate,
                pilotName);

            return new ViajeResponseDto
            {
                IdViaje = viaje.IdViaje,
                IdUsuario = viaje.IdUsuario,
                NombrePiloto = viaje.NombrePilotoSnapshot ?? pilotName,
                IdAutobus = viaje.IdAutobus,
                PlacaAutobus = viaje.PlacaSnapshot ?? plate,
                IdRuta = viaje.IdRuta,
                NombreRuta = viaje.NombreRutaSnapshot ?? viaje.DestinoNombre ?? "Ruta por definir",
                OrigenRuta = viaje.OrigenSnapshot ?? "Punto de salida",
                DestinoRuta = viaje.DestinoNombre ?? viaje.DestinoSnapshot ?? "Destino por confirmar",
                DestinoLatitud = viaje.DestinoLatitud,
                DestinoLongitud = viaje.DestinoLongitud,
                DestinoNombre = viaje.DestinoNombre,
                FechaInicio = viaje.FechaInicio,
                FechaFin = viaje.FechaFin,
                EstadoViaje = viaje.EstadoViaje ?? "Finalizado"
            };
        }
    }
}
