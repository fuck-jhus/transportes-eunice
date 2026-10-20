using Microsoft.EntityFrameworkCore;
using AccesoDatos.Context;
using AccesoDatos.Models;
using webapi.Controllers;
using webapi.Dtos;
using webapi.Core;
using System.Data;

namespace webapi.Services
{
    public class UserService : IUserService
    {
        private readonly PrevencionAccidentesBusesContext _context;

        public UserService(PrevencionAccidentesBusesContext context)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
        }

        public async Task<IEnumerable<UserResponseDto>> GetUsuariosAsync()
        {
            return await _context.Usuarios
                .WithoutDeletedAccounts()
                .AsNoTracking()
                .Select(u => new UserResponseDto
                {
                    IdUsuario = u.IdUsuario,
                    NombreCompleto = u.NombreCompleto,
                    TipoRol = u.TipoRol,
                    UsuarioLogin = u.UsuarioLogin,
                    Estado = u.Estado,
                    Version = u.Version
                })
                .ToListAsync();
        }

        public async Task<UserResponseDto?> GetUsuarioByIdAsync(int id)
        {
            var usuario = await _context.Usuarios
                .WithoutDeletedAccounts()
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.IdUsuario == id);

            if (usuario == null) return null;

            return new UserResponseDto
            {
                IdUsuario = usuario.IdUsuario,
                NombreCompleto = usuario.NombreCompleto,
                TipoRol = usuario.TipoRol,
                UsuarioLogin = usuario.UsuarioLogin,
                Estado = usuario.Estado,
                Version = usuario.Version
            };
        }

        public async Task<UserResponseDto> CrearUsuarioAsync(CrearUsuarioDto dto)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => CrearUsuarioTransactionalAsync(dto));
        }

        private async Task<UserResponseDto> CrearUsuarioTransactionalAsync(CrearUsuarioDto dto)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var normalizedLogin = dto.UsuarioLogin.Trim();
            if (string.Equals(normalizedLogin, "superadmin", StringComparison.OrdinalIgnoreCase)
                || UserAccounts.IsDeletedLogin(normalizedLogin))
            {
                throw new InvalidOperationException("Ese nombre de usuario está reservado por el sistema.");
            }

            // Validar unicidad del login de usuario
            bool existeLogin = await _context.Usuarios
                .AnyAsync(u => u.UsuarioLogin == normalizedLogin);

            if (existeLogin)
            {
                throw new InvalidOperationException($"El nombre de usuario '{normalizedLogin}' ya se encuentra registrado.");
            }

            var nuevoUsuario = new Usuario
            {
                NombreCompleto = dto.NombreCompleto.Trim(),
                TipoRol = dto.TipoRol,
                UsuarioLogin = normalizedLogin,
                Contrasena = BCrypt.Net.BCrypt.HashPassword(dto.Contrasena), // Hash BCrypt obligatorio
                Estado = dto.Estado
            };

            _context.Usuarios.Add(nuevoUsuario);
            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return new UserResponseDto
            {
                IdUsuario = nuevoUsuario.IdUsuario,
                NombreCompleto = nuevoUsuario.NombreCompleto,
                TipoRol = nuevoUsuario.TipoRol,
                UsuarioLogin = nuevoUsuario.UsuarioLogin,
                Estado = nuevoUsuario.Estado,
                Version = nuevoUsuario.Version
            };
        }

        public async Task<UserResponseDto?> EditarUsuarioAsync(int id, EditarUsuarioDto dto)
        {
            var result = await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => EditarUsuarioTransactionalAsync(id, dto));
            await BroadcastFinalizedTripsAsync(result.FinalizedTrips);
            return result.User;
        }

        private async Task<(UserResponseDto? User, List<(int UserId, string Plate, string Name)> FinalizedTrips)> EditarUsuarioTransactionalAsync(int id, EditarUsuarioDto dto)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var usuario = await _context.Usuarios.WithoutDeletedAccounts().FirstOrDefaultAsync(u => u.IdUsuario == id);
            if (usuario == null) return (null, []);
            if (dto.Version != null && !usuario.Version.SequenceEqual(dto.Version)) throw new InvalidOperationException("La cuenta cambió desde que la abriste. Recárgala antes de guardar.");

            var normalizedLogin = dto.UsuarioLogin.Trim();
            if (UserAccounts.IsDeletedLogin(normalizedLogin)
                && !string.Equals(usuario.UsuarioLogin, normalizedLogin, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Ese nombre de usuario está reservado por el sistema.");
            var isProtectedAccount = string.Equals(usuario.UsuarioLogin, "superadmin", StringComparison.OrdinalIgnoreCase);
            if (isProtectedAccount && !string.Equals(normalizedLogin, "superadmin", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("La cuenta principal no puede cambiar su nombre de usuario.");
            }
            if (!isProtectedAccount && string.Equals(normalizedLogin, "superadmin", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Ese nombre de usuario está reservado por el sistema.");
            }

            // Validar unicidad si el usuario está cambiando su nombre de login
            if (!string.Equals(usuario.UsuarioLogin, normalizedLogin, StringComparison.OrdinalIgnoreCase))
            {
                bool existeLogin = await _context.Usuarios
                    .AnyAsync(u => u.UsuarioLogin == normalizedLogin && u.IdUsuario != id);

                if (existeLogin)
                {
                    throw new InvalidOperationException($"El nombre de usuario '{normalizedLogin}' ya está en uso por otra cuenta.");
                }
            }

            // Actualizar datos básicos
            usuario.NombreCompleto = dto.NombreCompleto.Trim();
            usuario.TipoRol = dto.TipoRol;
            usuario.UsuarioLogin = normalizedLogin;
            if (dto.Estado != null) usuario.Estado = dto.Estado;

            // Cifrar y actualizar contraseña únicamente si se proporcionó una nueva
            if (!string.IsNullOrWhiteSpace(dto.Contrasena))
            {
                usuario.Contrasena = BCrypt.Net.BCrypt.HashPassword(dto.Contrasena);
            }

            var finalizedTrips = usuario.TipoRol != "Piloto" || usuario.Estado != "Activo"
                ? await FinalizeActiveTripsAsync(usuario)
                : [];

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return (new UserResponseDto
            {
                IdUsuario = usuario.IdUsuario,
                NombreCompleto = usuario.NombreCompleto,
                TipoRol = usuario.TipoRol,
                UsuarioLogin = usuario.UsuarioLogin,
                Estado = usuario.Estado,
                Version = usuario.Version
            }, finalizedTrips);
        }

        public async Task<bool> CambiarEstadoUsuarioAsync(int id, string nuevoEstado)
        {
            var result = await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => CambiarEstadoUsuarioTransactionalAsync(id, nuevoEstado));
            await BroadcastFinalizedTripsAsync(result.FinalizedTrips);
            return result.Found;
        }

        private async Task<(bool Found, List<(int UserId, string Plate, string Name)> FinalizedTrips)> CambiarEstadoUsuarioTransactionalAsync(int id, string nuevoEstado)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var usuario = await _context.Usuarios.WithoutDeletedAccounts().FirstOrDefaultAsync(u => u.IdUsuario == id);
            if (usuario == null) return (false, []);

            usuario.Estado = nuevoEstado;
            var finalizedTrips = nuevoEstado != "Activo"
                ? await FinalizeActiveTripsAsync(usuario)
                : [];
            await _context.SaveChangesAsync();
            await transaction.CommitAsync();
            return (true, finalizedTrips);
        }

        public async Task<bool> EliminarUsuarioAsync(int id)
        {
            var result = await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => EliminarUsuarioTransactionalAsync(id));
            if (result.Found)
            {
                WebSocketConnectionManager.DisconnectUser(id);
                await WebSocketConnectionManager.BroadcastUserRemovedAsync(id);
            }
            await BroadcastFinalizedTripsAsync(result.FinalizedTrips);
            return result.Found;
        }

        private async Task<(bool Found, List<(int UserId, string Plate, string Name)> FinalizedTrips)> EliminarUsuarioTransactionalAsync(int id)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var usuario = await _context.Usuarios.WithoutDeletedAccounts().FirstOrDefaultAsync(u => u.IdUsuario == id);
            if (usuario == null) return (false, []);

            var finalizedTrips = await FinalizeActiveTripsAsync(usuario);

            // Revocar dispositivos y relaciones sociales inmediatamente. Estos datos no
            // forman parte del historial de seguridad que la operación debe conservar.
            var pushDevices = await _context.DispositivosPush
                .Where(device => device.IdUsuario == id)
                .ToListAsync();
            _context.DispositivosPush.RemoveRange(pushDevices);

            var chatBlocks = await _context.UsuariosChatBloqueados
                .Where(block => block.IdUsuario == id || block.IdUsuarioBloqueado == id)
                .ToListAsync();
            _context.UsuariosChatBloqueados.RemoveRange(chatBlocks);

            // Preservar telemetría, alertas y evaluaciones como historial auditable.
            // Las cuentas con actividad se retiran mediante baja lógica.
            var tieneHistorial = await _context.ViajesDiarios.AnyAsync(v => v.IdUsuario == id)
                || await _context.EvaluacionesPilotoMensuales.AnyAsync(e => e.IdUsuario == id)
                || await _context.MensajesChat.AnyAsync(message =>
                    message.IdEmisor == id || message.IdEliminadoPor == id || message.IdPilotoCanal == id)
                || await _context.ViajesAccesosPublicos.AnyAsync(access => access.IdCreadoPor == id)
                || await _context.MensajesPasajeros.AnyAsync(message => message.IdUsuarioEmisor == id)
                || await _context.ReportesContenido.AnyAsync(report => report.IdReportante == id);

            if (tieneHistorial)
            {
                usuario.Estado = "Inactivo";
                usuario.NombreCompleto = "Cuenta eliminada";
                var deletedLogin = $"deleted_{id}_{Guid.NewGuid():N}";
                usuario.UsuarioLogin = deletedLogin[..Math.Min(50, deletedLogin.Length)];
                usuario.Contrasena = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N"));
                var journeys = await _context.ViajesDiarios.Where(trip => trip.IdUsuario == id).ToListAsync();
                foreach (var trip in journeys) trip.NombrePilotoSnapshot = "Cuenta eliminada";
                finalizedTrips = finalizedTrips.Select(trip => (UserId: trip.UserId, Plate: trip.Plate, Name: "Cuenta eliminada")).ToList();

                var now = DateTime.UtcNow;
                var authoredMessages = await _context.MensajesChat
                    .Where(message => message.IdEmisor == id)
                    .ToListAsync();
                foreach (var message in authoredMessages)
                {
                    message.NombreEmisor = "Cuenta eliminada";
                    message.Contenido = "[Mensaje eliminado por el usuario]";
                    message.Eliminado = true;
                    message.FechaEliminacion ??= now;
                    message.IdEliminadoPor = null;
                }

                var moderatedMessages = await _context.MensajesChat
                    .Where(message => message.IdEliminadoPor == id)
                    .ToListAsync();
                foreach (var message in moderatedMessages)
                {
                    message.IdEliminadoPor = null;
                }

                var pilotChannelMessages = await _context.MensajesChat
                    .Where(message => message.IdPilotoCanal == id)
                    .ToListAsync();
                foreach (var message in pilotChannelMessages)
                {
                    message.NombrePilotoCanal = "Cuenta eliminada";
                }

                var passengerMessages = await _context.MensajesPasajeros
                    .Where(message => message.IdUsuarioEmisor == id)
                    .ToListAsync();
                foreach (var message in passengerMessages)
                {
                    message.IdUsuarioEmisor = null;
                    message.NombreEmisor = "Cuenta eliminada";
                    message.Contenido = "[Mensaje eliminado por el usuario]";
                }

                var publicAccesses = await _context.ViajesAccesosPublicos
                    .Where(access => access.IdCreadoPor == id)
                    .ToListAsync();
                foreach (var access in publicAccesses)
                {
                    access.IdCreadoPor = null;
                }

                var contentReports = await _context.ReportesContenido
                    .Where(report => report.IdReportante == id || report.IdUsuarioReportado == id)
                    .ToListAsync();
                foreach (var report in contentReports.Where(report => report.IdUsuarioReportado == id))
                {
                    report.IdUsuarioReportado = null;
                    report.AliasReportado = "Cuenta eliminada";
                }
            }
            else
            {
                _context.Usuarios.Remove(usuario);
            }

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();
            return (true, finalizedTrips);
        }

        private async Task<List<(int UserId, string Plate, string Name)>> FinalizeActiveTripsAsync(Usuario user)
        {
            var activeTrips = await _context.ViajesDiarios
                .Include(trip => trip.IdAutobusNavigation)
                .Where(trip => trip.IdUsuario == user.IdUsuario && trip.EstadoViaje == "En Curso")
                .ToListAsync();

            foreach (var trip in activeTrips)
            {
                await webapi.Core.TripLifecycle.FinishAsync(_context, trip, "Cuenta desactivada o rol modificado");
            }

            return activeTrips
                .Select(trip => (user.IdUsuario, trip.IdAutobusNavigation.Placa, user.NombreCompleto))
                .ToList();
        }

        private static async Task BroadcastFinalizedTripsAsync(IEnumerable<(int UserId, string Plate, string Name)> trips)
        {
            foreach (var trip in trips)
            {
                await webapi.Core.WebSocketConnectionManager.BroadcastPilotOfflineAsync(
                    trip.UserId,
                    trip.Plate,
                    trip.Name);
            }
        }
    }
}
