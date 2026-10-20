using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using webapi.Dtos;

namespace webapi.Core
{
    public class AuthenticatedWebSocket
    {
        public WebSocket Socket { get; set; } = null!;
        public int UserId { get; set; }
        public string Nombre { get; set; } = string.Empty;
        public string Rol { get; set; } = string.Empty;
        public DateTime ConnectedAt { get; set; } = DateTime.UtcNow;
        public SemaphoreSlim SendLock { get; } = new(1, 1);
    }

    public static class WebSocketConnectionManager
    {
        private static readonly List<AuthenticatedWebSocket> _connections = new List<AuthenticatedWebSocket>();
        private static readonly Dictionary<string, (TelemetriaLiveDto Telemetry, int? UserId, DateTime UpdatedAt)> _activeTelemetry =
            new(StringComparer.OrdinalIgnoreCase);
        private static readonly object _lock = new object();

        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        public static void AddSocket(WebSocket socket, int userId, string nombre, string rol)
        {
            lock (_lock)
            {
                // Limpiar posibles conexiones previas cerradas
                _connections.RemoveAll(c => c.Socket.State != WebSocketState.Open);
                _connections.Add(new AuthenticatedWebSocket
                {
                    Socket = socket,
                    UserId = userId,
                    Nombre = nombre,
                    Rol = rol,
                    ConnectedAt = DateTime.UtcNow
                });
            }
        }

        public static void RemoveSocket(WebSocket socket)
        {
            lock (_lock)
            {
                _connections.RemoveAll(c => c.Socket == socket || c.Socket.State != WebSocketState.Open);
            }
        }

        public static int GetActiveCount()
        {
            lock (_lock)
            {
                return _connections.Count(c => c.Socket.State == WebSocketState.Open);
            }
        }

        public static void DisconnectUser(int userId)
        {
            List<AuthenticatedWebSocket> removed;
            lock (_lock)
            {
                removed = _connections.Where(c => c.UserId == userId).ToList();
                _connections.RemoveAll(c => c.UserId == userId);
            }
            foreach (var connection in removed)
            {
                try { connection.Socket.Abort(); } catch { }
            }
        }

        public static async Task BroadcastUserRemovedAsync(int userId)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                targets = _connections.Where(c => c.Socket.State == WebSocketState.Open
                    && c.Rol is "Administrador" or "SuperAdministrador" or "Supervisor").ToList();
            }
            await SendToSocketsAsync(targets, new
            {
                tipoMensaje = "usuario_eliminado",
                data = new { idUsuario = userId }
            });
        }

        private static async Task SendToSocketsAsync(IEnumerable<AuthenticatedWebSocket> targets, object payload)
        {
            var json = JsonSerializer.Serialize(payload, _jsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            var tasks = targets.Select(async conn =>
            {
                if (conn.Socket.State == WebSocketState.Open)
                {
                    var lockAcquired = false;
                    var failed = false;
                    try
                    {
                        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(1500));
                        await conn.SendLock.WaitAsync(cts.Token);
                        lockAcquired = true;
                        await conn.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cts.Token);
                    }
                    catch
                    {
                        failed = true;
                    }
                    finally
                    {
                        if (lockAcquired) conn.SendLock.Release();
                    }

                    if (failed)
                    {
                        RemoveSocket(conn.Socket);
                        try { conn.Socket.Abort(); } catch { }
                    }
                }
            });

            await Task.WhenAll(tasks);
        }

        public static async Task SendHeartbeatAsync(WebSocket socket)
        {
            AuthenticatedWebSocket? connection;
            lock (_lock)
            {
                connection = _connections.FirstOrDefault(item => item.Socket == socket);
            }

            if (connection == null) return;

            await SendToSocketsAsync(new[] { connection }, new
            {
                tipoMensaje = "pong",
                fechaHora = DateTime.UtcNow
            });
        }

        public static async Task BroadcastAlertAsync(AlertaResponseDto alert, int? idPilotoAfectado = null)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                _connections.RemoveAll(c => c.Socket.State != WebSocketState.Open);
                // Las alertas se envían a los perfiles operativos y al piloto involucrado.
                targets = _connections.Where(c => 
                    c.Rol == "Administrador" || 
                    c.Rol == "SuperAdministrador" || 
                    c.Rol == "Supervisor" || 
                    (idPilotoAfectado.HasValue && c.UserId == idPilotoAfectado.Value)
                ).ToList();
            }

            var payload = new
            {
                tipoMensaje = "alerta",
                data = alert
            };

            await SendToSocketsAsync(targets, payload);
        }

        public static IReadOnlyList<TelemetriaLiveDto> GetActiveTelemetry(TimeSpan? maxAge = null)
        {
            var cutoff = DateTime.UtcNow - (maxAge ?? TimeSpan.FromMinutes(2));
            lock (_lock)
            {
                foreach (var staleKey in _activeTelemetry
                    .Where(item => item.Value.UpdatedAt < cutoff)
                    .Select(item => item.Key)
                    .ToList())
                {
                    _activeTelemetry.Remove(staleKey);
                }

                return _activeTelemetry.Values
                    .OrderByDescending(item => item.UpdatedAt)
                    .Select(item => item.Telemetry)
                    .ToList();
            }
        }

        public static async Task BroadcastTelemetryAsync(TelemetriaLiveDto telemetry, int? userId = null)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                _connections.RemoveAll(c => c.Socket.State != WebSocketState.Open);
                if (!string.IsNullOrWhiteSpace(telemetry.PlacaAutobus))
                {
                    // REST history batches can finish after newer live socket frames.
                    // Never rewind the shared snapshot or make old offline points live.
                    var measuredAt = DateTime.SpecifyKind(telemetry.FechaHoraDispositivo, DateTimeKind.Utc);
                    if (!telemetry.IsPrivacyMode)
                    {
                        if (measuredAt < DateTime.UtcNow.AddMinutes(-2) || measuredAt > DateTime.UtcNow.AddMinutes(5)) return;
                        if (_activeTelemetry.TryGetValue(telemetry.PlacaAutobus, out var previous)
                            && !previous.Telemetry.IsPrivacyMode
                            && previous.Telemetry.FechaHoraDispositivo > telemetry.FechaHoraDispositivo) return;
                    }
                    _activeTelemetry[telemetry.PlacaAutobus] = (telemetry, userId, DateTime.UtcNow);
                }
                // Telemetría en vivo para monitores autorizados (panel de control / flota)
                targets = _connections.Where(c => 
                    c.Rol == "Administrador" || 
                    c.Rol == "SuperAdministrador" || 
                    c.Rol == "Supervisor"
                ).ToList();
            }

            var payload = new
            {
                tipoMensaje = "telemetria",
                data = telemetry
            };

            await SendToSocketsAsync(targets, payload);
        }

        public static async Task BroadcastChatMessageAsync(object chatMessage, int idPilotoCanal = 0, int idEmisor = 0, IReadOnlyCollection<int>? excludedUsers = null)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                _connections.RemoveAll(c => c.Socket.State != WebSocketState.Open);

                if (idPilotoCanal == 0)
                {
                    // Canal General: todos los usuarios autenticados reciben el mensaje
                    targets = _connections.ToList();
                }
                else
                {
                    // Canal Privado: SOLO Administradores, Supervisores y el Piloto específico involucrado
                    targets = _connections.Where(c => 
                        c.Rol == "Administrador" || 
                        c.Rol == "SuperAdministrador" || 
                        c.Rol == "Supervisor" || 
                        c.UserId == idPilotoCanal || 
                        c.UserId == idEmisor
                    ).ToList();
                }
            }

            var payload = new
            {
                tipoMensaje = "chat",
                data = chatMessage
            };

            await SendToSocketsAsync(targets.Where(target => excludedUsers == null || !excludedUsers.Contains(target.UserId)), payload);
        }

        public static async Task BroadcastChatDeleteAsync(string idMensaje, int idPilotoCanal = 0)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                _connections.RemoveAll(c => c.Socket.State != WebSocketState.Open);

                if (idPilotoCanal == 0)
                {
                    targets = _connections.ToList();
                }
                else
                {
                    targets = _connections.Where(c => 
                        c.Rol == "Administrador" || 
                        c.Rol == "SuperAdministrador" || 
                        c.Rol == "Supervisor" || 
                        c.UserId == idPilotoCanal
                    ).ToList();
                }
            }

            var payload = new
            {
                tipoMensaje = "chat_delete",
                idMensaje = idMensaje
            };

            await SendToSocketsAsync(targets, payload);
        }

        public static async Task BroadcastPassengerMessageAsync(object passengerMessage, int pilotUserId)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                _connections.RemoveAll(connection => connection.Socket.State != WebSocketState.Open);
                targets = _connections.Where(connection =>
                    connection.Rol == "Administrador" ||
                    connection.Rol == "SuperAdministrador" ||
                    connection.Rol == "Supervisor" ||
                    connection.UserId == pilotUserId
                ).ToList();
            }

            await SendToSocketsAsync(targets, new
            {
                tipoMensaje = "mensaje_pasajero",
                data = passengerMessage
            });
        }

        public static async Task BroadcastChatClearAsync(int idPilotoCanal)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                _connections.RemoveAll(c => c.Socket.State != WebSocketState.Open);

                if (idPilotoCanal <= 0)
                {
                    targets = _connections.ToList();
                }
                else
                {
                    targets = _connections.Where(c => 
                        c.Rol == "Administrador" || 
                        c.Rol == "SuperAdministrador" || 
                        c.Rol == "Supervisor" || 
                        c.UserId == idPilotoCanal
                    ).ToList();
                }
            }

            var payload = new
            {
                tipoMensaje = "chat_clear",
                idPilotoCanal = idPilotoCanal
            };

            await SendToSocketsAsync(targets, payload);
        }

        public static async Task BroadcastPilotOfflineAsync(int idUsuario, string? placaAutobus = null, string? nombrePiloto = null)
        {
            List<AuthenticatedWebSocket> targets;
            lock (_lock)
            {
                _connections.RemoveAll(c => c.Socket.State != WebSocketState.Open);
                foreach (var key in _activeTelemetry
                    .Where(item =>
                        (!string.IsNullOrWhiteSpace(placaAutobus) && string.Equals(item.Key, placaAutobus, StringComparison.OrdinalIgnoreCase))
                        || item.Value.UserId == idUsuario)
                    .Select(item => item.Key)
                    .ToList())
                {
                    _activeTelemetry.Remove(key);
                }
                targets = _connections.Where(c =>
                    c.Rol == "Administrador" ||
                    c.Rol == "SuperAdministrador" ||
                    c.Rol == "Supervisor" ||
                    c.UserId == idUsuario
                ).ToList();
            }

            var payload = new
            {
                tipoMensaje = "piloto_offline",
                data = new
                {
                    idUsuario = idUsuario,
                    placaAutobus = placaAutobus,
                    nombrePiloto = nombrePiloto,
                    isOffline = true,
                    isPrivacyMode = true
                }
            };

            await SendToSocketsAsync(targets, payload);
        }
    }
}
