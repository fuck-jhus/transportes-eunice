using Microsoft.EntityFrameworkCore;
using AccesoDatos.Context;
using AccesoDatos.Models;
using webapi.Dtos;
using webapi.Core;
using System.Data;

namespace webapi.Services
{
    public class AutobusService : IAutobusService
    {
        private readonly PrevencionAccidentesBusesContext _context;
        private readonly IPushNotificationService _push;
        private readonly ILogger<AutobusService>? _logger;

        public AutobusService(PrevencionAccidentesBusesContext context, IPushNotificationService? push = null, ILogger<AutobusService>? logger = null)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
            _push = push ?? NullPushNotificationService.Instance;
            _logger = logger;
        }

        public async Task<IEnumerable<AutobusResponseDto>> GetAutobusesAsync()
        {
            return await _context.Autobuses
                .AsNoTracking()
                .Select(bus => new AutobusResponseDto
                {
                    IdAutobus = bus.IdAutobus,
                    Placa = bus.Placa,
                    MarcaModelo = bus.MarcaModelo,
                    Estado = bus.Estado ?? string.Empty,
                    Version = bus.Version,
                    IdViajeActivo = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => (int?)t.IdViaje).FirstOrDefault(),
                    IdPilotoAsignado = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => (int?)t.IdUsuario).FirstOrDefault(),
                    IdRutaAsignada = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => t.IdRuta).FirstOrDefault(),
                    NombrePiloto = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => t.IdUsuarioNavigation.NombreCompleto).FirstOrDefault(),
                    Disponibilidad = bus.Estado != "Activo" ? bus.Estado! : bus.ViajeDiarios.Any(t => t.EstadoViaje == "En Curso") ? "En viaje" : "Disponible"
                })
                .ToListAsync();
        }

        public async Task<AutobusResponseDto?> GetAutobusByIdAsync(int id)
        {
            return await _context.Autobuses
                .AsNoTracking()
                .Where(bus => bus.IdAutobus == id)
                .Select(bus => new AutobusResponseDto
                {
                    IdAutobus = bus.IdAutobus,
                    Placa = bus.Placa,
                    MarcaModelo = bus.MarcaModelo,
                    Estado = bus.Estado ?? string.Empty,
                    Version = bus.Version,
                    IdViajeActivo = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => (int?)t.IdViaje).FirstOrDefault(),
                    IdPilotoAsignado = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => (int?)t.IdUsuario).FirstOrDefault(),
                    IdRutaAsignada = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => t.IdRuta).FirstOrDefault(),
                    NombrePiloto = bus.ViajeDiarios.Where(t => t.EstadoViaje == "En Curso").Select(t => t.IdUsuarioNavigation.NombreCompleto).FirstOrDefault(),
                    Disponibilidad = bus.Estado != "Activo" ? bus.Estado! : bus.ViajeDiarios.Any(t => t.EstadoViaje == "En Curso") ? "En viaje" : "Disponible"
                })
                .FirstOrDefaultAsync();
        }

        public async Task<AutobusResponseDto> CrearAutobusAsync(CrearAutobusDto dto)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => CrearAutobusTransactionalAsync(dto));
        }

        private async Task<AutobusResponseDto> CrearAutobusTransactionalAsync(CrearAutobusDto dto)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var normalizedPlate = dto.Placa.Trim().ToUpperInvariant();
            var pilotId = NormalizeId(dto.IdPilotoAsignado);
            var routeId = NormalizeId(dto.IdRutaAsignada);

            bool existePlaca = await _context.Autobuses
                .AnyAsync(a => a.Placa == normalizedPlate);

            if (existePlaca)
            {
                throw new InvalidOperationException($"La placa '{normalizedPlate}' ya está registrada.");
            }

            if (routeId.HasValue && !pilotId.HasValue)
            {
                throw new InvalidOperationException("No se puede asignar una ruta sin seleccionar un piloto.");
            }

            if (pilotId.HasValue && dto.Estado != "Activo")
            {
                throw new InvalidOperationException("Solo se puede asignar un piloto a un autobús activo.");
            }

            Usuario? piloto = null;
            Rutum? ruta = null;
            if (pilotId.HasValue)
            {
                (piloto, ruta) = await ValidateAssignmentAsync(pilotId.Value, routeId, null);
            }

            var nuevoAutobus = new Autobus
            {
                Placa = normalizedPlate,
                MarcaModelo = dto.MarcaModelo?.Trim(),
                Estado = dto.Estado
            };

            _context.Autobuses.Add(nuevoAutobus);

            ViajeDiario? assignedTrip = null;
            if (piloto != null)
            {
                var trip = new ViajeDiario
                {
                    IdUsuario = piloto.IdUsuario,
                    IdAutobusNavigation = nuevoAutobus,
                    IdRuta = ruta?.IdRuta,
                    FechaInicio = DateTime.UtcNow,
                    EstadoViaje = "En Curso"
                };
                webapi.Core.TripLifecycle.Snapshot(trip, piloto, nuevoAutobus, ruta);
                _context.ViajesDiarios.Add(trip);
                assignedTrip = trip;
            }

            await _context.SaveChangesAsync();
            if (assignedTrip != null) await NotifyAssignmentAsync(assignedTrip, nuevoAutobus, false);
            await transaction.CommitAsync();
            return ToResponse(nuevoAutobus);
        }

        public async Task<AutobusResponseDto?> EditarAutobusAsync(int id, EditarAutobusDto dto)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => EditarAutobusTransactionalAsync(id, dto));
        }

        private async Task<AutobusResponseDto?> EditarAutobusTransactionalAsync(int id, EditarAutobusDto dto)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var autobus = await _context.Autobuses.FirstOrDefaultAsync(a => a.IdAutobus == id);
            if (autobus == null) return null;
            var normalizedPlate = dto.Placa.Trim().ToUpperInvariant();

            // Validar unicidad si cambia de placa
            if (!string.Equals(autobus.Placa, normalizedPlate, StringComparison.OrdinalIgnoreCase))
            {
                bool existePlaca = await _context.Autobuses
                    .AnyAsync(a => a.Placa == normalizedPlate && a.IdAutobus != id);

                if (existePlaca)
                {
                    throw new InvalidOperationException($"La placa '{normalizedPlate}' ya está en uso por otro autobús.");
                }
            }

            var activeTrips = await _context.ViajesDiarios
                .Where(v => v.IdAutobus == id && v.EstadoViaje == "En Curso")
                .ToListAsync();
            if (activeTrips.Count > 1)
            {
                throw new InvalidOperationException("El autobús tiene más de una asignación activa. Corrige los viajes duplicados antes de editarlo.");
            }

            var currentTrip = activeTrips.SingleOrDefault();
            var requestedPilotId = NormalizeId(dto.IdPilotoAsignado);
            var requestedRouteId = NormalizeId(dto.IdRutaAsignada);
            var assignmentChanged = dto.GestionarAsignacion
                && currentTrip?.IdUsuario != requestedPilotId;
            if (dto.Version != null && !autobus.Version.SequenceEqual(dto.Version))
                throw new InvalidOperationException("La unidad cambió desde que la abriste. Recarga antes de guardar.");
            if (dto.GestionarAsignacion && dto.IdViajeEsperado != currentTrip?.IdViaje)
                throw new InvalidOperationException("La asignación cambió. Recarga la unidad antes de reasignarla.");

            if (!dto.GestionarAsignacion && dto.Estado != "Activo" && currentTrip != null)
            {
                throw new InvalidOperationException("Finaliza o retira la asignación activa antes de cambiar el estado del autobús.");
            }

            if (dto.GestionarAsignacion)
            {
                if (requestedRouteId.HasValue && !requestedPilotId.HasValue)
                {
                    throw new InvalidOperationException("No se puede asignar una ruta sin seleccionar un piloto.");
                }

                if (requestedPilotId.HasValue && dto.Estado != "Activo")
                {
                    throw new InvalidOperationException("Solo se puede asignar un piloto a un autobús activo.");
                }

                if (assignmentChanged && requestedPilotId.HasValue)
                {
                    await ValidateAssignmentAsync(requestedPilotId.Value, requestedRouteId, currentTrip?.IdViaje);
                }
            }

            autobus.Placa = normalizedPlate;
            autobus.MarcaModelo = dto.MarcaModelo?.Trim();
            autobus.Estado = dto.Estado;
            _context.Entry(autobus).Property(x => x.Estado).IsModified = true; // Advance its rowversion even for assignment-only changes.

            int? disconnectedPilotId = null;
            ViajeDiario? updatedAssignment = null;
            if (assignmentChanged && currentTrip != null)
            {
                await webapi.Core.TripLifecycle.FinishAsync(_context, currentTrip, "Relevo de conductor");
                disconnectedPilotId = currentTrip.IdUsuario;
            }

            if (!assignmentChanged && dto.GestionarAsignacion && currentTrip != null && currentTrip.IdRuta != requestedRouteId)
            {
                var route = requestedRouteId.HasValue ? await _context.Ruta.FindAsync(requestedRouteId.Value) : null;
                if (requestedRouteId.HasValue && route == null) throw new InvalidOperationException("La ruta ya no existe.");
                currentTrip.IdRuta = requestedRouteId;
                currentTrip.DestinoNombre = route?.Destino;
                currentTrip.DestinoLatitud = route?.DestinoLatitud;
                currentTrip.DestinoLongitud = route?.DestinoLongitud;
                currentTrip.NombreRutaSnapshot = route?.NombreRuta;
                currentTrip.OrigenSnapshot = route?.Origen;
                currentTrip.DestinoSnapshot = route?.Destino;
                currentTrip.NavegacionActualizada = DateTime.UtcNow;
                currentTrip.RevisionDestino++;
                updatedAssignment = currentTrip;
            }

            if (assignmentChanged && requestedPilotId.HasValue)
            {
                if (currentTrip != null) await _context.SaveChangesAsync(); // Release filtered active index before inserting the replacement, within the same transaction.
                var newTrip = new ViajeDiario
                {
                    IdUsuario = requestedPilotId.Value,
                    IdAutobus = autobus.IdAutobus,
                    IdRuta = requestedRouteId,
                    FechaInicio = DateTime.UtcNow,
                    EstadoViaje = "En Curso"
                };
                webapi.Core.TripLifecycle.Snapshot(newTrip, await _context.Usuarios.FindAsync(requestedPilotId.Value), autobus,
                    requestedRouteId.HasValue ? await _context.Ruta.FindAsync(requestedRouteId.Value) : null);
                _context.ViajesDiarios.Add(newTrip);
                updatedAssignment = newTrip;
            }

            await _context.SaveChangesAsync();
            if (updatedAssignment != null) await NotifyAssignmentAsync(updatedAssignment, autobus, !assignmentChanged);
            await transaction.CommitAsync();
            if (disconnectedPilotId.HasValue)
            {
                await webapi.Core.WebSocketConnectionManager.BroadcastPilotOfflineAsync(
                    disconnectedPilotId.Value,
                    autobus.Placa);
            }

            return ToResponse(autobus);
        }

        private Task NotifyAssignmentAsync(ViajeDiario trip, Autobus bus, bool routeChanged) =>
            _push.SendToUsersAsync([trip.IdUsuario],
                routeChanged ? "Destino actualizado" : "Nuevo viaje asignado",
                routeChanged ? $"Despacho actualizó la ruta de {bus.Placa}. Abre Eunice para revisarla."
                    : $"Tienes un viaje asignado en la unidad {bus.Placa}. Abre Eunice para iniciar.",
                new Dictionary<string, string?> { ["eventKey"] = routeChanged ? $"destination:{trip.IdViaje}:{trip.RevisionDestino}" : $"trip-assigned:{trip.IdViaje}",
                    ["type"] = routeChanged ? "trip_destination" : "trip_assignment", ["tab"] = "trips", ["tripId"] = trip.IdViaje.ToString() });

        private static AutobusResponseDto ToResponse(Autobus bus) => new()
        {
            IdAutobus = bus.IdAutobus,
            Placa = bus.Placa,
            MarcaModelo = bus.MarcaModelo,
            Estado = bus.Estado ?? string.Empty,
            Version = bus.Version
        };

        private async Task<(Usuario Pilot, Rutum? Route)> ValidateAssignmentAsync(
            int pilotId,
            int? routeId,
            int? activeTripIdToIgnore)
        {
            var pilot = await _context.Usuarios.WithoutDeletedAccounts().FirstOrDefaultAsync(u => u.IdUsuario == pilotId);
            if (pilot == null)
            {
                throw new InvalidOperationException("El piloto especificado no existe.");
            }
            if (pilot.TipoRol != "Piloto")
            {
                throw new InvalidOperationException("El usuario seleccionado no es un piloto.");
            }
            if (pilot.Estado != "Activo")
            {
                throw new InvalidOperationException("El piloto seleccionado está inactivo.");
            }

            bool pilotBusy = await _context.ViajesDiarios.AnyAsync(v =>
                v.IdUsuario == pilotId
                && v.EstadoViaje == "En Curso"
                && (!activeTripIdToIgnore.HasValue || v.IdViaje != activeTripIdToIgnore.Value));
            if (pilotBusy)
            {
                throw new InvalidOperationException($"El piloto '{pilot.NombreCompleto}' ya tiene un viaje en curso asignado.");
            }

            Rutum? route = null;
            if (routeId.HasValue)
            {
                route = await _context.Ruta.FirstOrDefaultAsync(r => r.IdRuta == routeId.Value);
                if (route == null)
                {
                    throw new InvalidOperationException("La ruta especificada no existe.");
                }
            }

            return (pilot, route);
        }

        private static int? NormalizeId(int? id) => id is > 0 ? id : null;

        public async Task<bool> EliminarAutobusAsync(int id)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => EliminarAutobusTransactionalAsync(id));
        }

        private async Task<bool> EliminarAutobusTransactionalAsync(int id)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var autobus = await _context.Autobuses.FirstOrDefaultAsync(a => a.IdAutobus == id);
            if (autobus == null) return false;

            // Evitar caída por Constraint de Foreing Key en SQL Server
            bool tieneViajes = await _context.ViajesDiarios.AnyAsync(v => v.IdAutobus == id);
            if (tieneViajes)
            {
                throw new InvalidOperationException("No se puede eliminar el autobús porque tiene viajes registrados.");
            }

            _context.Autobuses.Remove(autobus);
            await _context.SaveChangesAsync();
            await transaction.CommitAsync();
            return true;
        }
    }
}
