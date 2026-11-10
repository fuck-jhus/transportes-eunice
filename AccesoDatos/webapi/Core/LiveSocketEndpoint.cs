using System.IdentityModel.Tokens.Jwt;
using System.Net.WebSockets;
using System.Security.Claims;
using System.Text.Json;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using webapi.Dtos;

namespace webapi.Core;

/// <summary>
/// Conexión WebSocket en <c>/ws</c>: autentica al usuario, mantiene viva la conexión y
/// retransmite a los operadores la telemetría en vivo que envían los pilotos.
/// Los datos que se guardan siguen llegando por REST; el socket solo es la vía rápida.
/// </summary>
public static class LiveSocketEndpoint
{
    private static readonly TimeSpan TripCacheDuration = TimeSpan.FromSeconds(5);

    private sealed record LiveTrip(ViajeDiario Trip, string Plate, string Route);

    public static void MapLiveSocket(this WebApplication app, IReadOnlyCollection<string> allowedOrigins, TokenValidationParameters tokenValidation)
    {
        app.UseWebSockets();
        app.Map("/ws", (HttpContext context) => HandleAsync(context, allowedOrigins, tokenValidation));
    }

    private static async Task HandleAsync(HttpContext context, IReadOnlyCollection<string> allowedOrigins, TokenValidationParameters tokenValidation)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsync("Se requiere una solicitud WebSocket.");
            return;
        }

        var origin = context.Request.Headers.Origin.ToString();
        if (!string.IsNullOrWhiteSpace(origin)
            && !allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsync("Origen no permitido.");
            return;
        }

        string? token = null;
        if (context.Request.Cookies.TryGetValue("AuthToken", out var cookieToken))
        {
            token = cookieToken;
        }
        else if (context.Request.Headers.TryGetValue("Authorization", out var authHeader)
            && authHeader.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            token = authHeader.ToString()[7..].Trim();
        }
        if (string.IsNullOrWhiteSpace(token))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        ClaimsPrincipal principal;
        try
        {
            principal = new JwtSecurityTokenHandler().ValidateToken(token, tokenValidation, out _);
        }
        catch
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (!int.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var authUserId))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var db = context.RequestServices.GetRequiredService<PrevencionAccidentesBusesContext>();
        var authenticatedUser = await db.Usuarios
            .WithoutDeletedAccounts()
            .AsNoTracking()
            .Where(user => user.IdUsuario == authUserId && user.Estado == EstadosRegistro.Activo)
            .Select(user => new { user.NombreCompleto, user.TipoRol, user.UsuarioLogin })
            .SingleOrDefaultAsync(context.RequestAborted);

        if (authenticatedUser is null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var authRole = UserAccounts.EffectiveRole(authenticatedUser.UsuarioLogin, authenticatedUser.TipoRol);
        if (authRole is not (RolesUsuario.Piloto or RolesUsuario.Administrador or RolesUsuario.SuperAdministrador or RolesUsuario.Supervisor))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
        if (!string.Equals(principal.FindFirstValue(ClaimTypes.Role), authRole, StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
        WebSocketConnectionManager.AddSocket(webSocket, authUserId, authenticatedUser.NombreCompleto, authRole);

        var buffer = new byte[4096];
        var messageWindowStart = DateTime.UtcNow;
        var messagesInWindow = 0;
        LiveTrip? activeTrip = null;
        var activeTripCheckedAt = DateTime.MinValue;

        try
        {
            // A deletion may commit between the first account lookup and AddSocket.
            // Recheck after registration so the removal cannot miss a new socket.
            if (!await db.Usuarios.WithoutDeletedAccounts().AnyAsync(
                account => account.IdUsuario == authUserId && account.Estado == EstadosRegistro.Activo, context.RequestAborted))
            {
                if (webSocket.State == WebSocketState.Open)
                    await webSocket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "La cuenta ya no está activa.", context.RequestAborted);
                return;
            }
            while (webSocket.State == WebSocketState.Open && !context.RequestAborted.IsCancellationRequested)
            {
                var result = await webSocket.ReceiveAsync(buffer, context.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await webSocket.CloseAsync(
                        result.CloseStatus ?? WebSocketCloseStatus.NormalClosure,
                        result.CloseStatusDescription,
                        context.RequestAborted);
                    break;
                }

                if (result.MessageType != WebSocketMessageType.Text || result.Count == 0)
                {
                    continue;
                }

                if (!result.EndOfMessage)
                {
                    await webSocket.CloseAsync(WebSocketCloseStatus.MessageTooBig, "Mensaje demasiado grande.", context.RequestAborted);
                    break;
                }

                var now = DateTime.UtcNow;
                if (now - messageWindowStart >= TimeSpan.FromMinutes(1))
                {
                    messageWindowStart = now;
                    messagesInWindow = 0;
                }

                if (++messagesInWindow > 180)
                {
                    await webSocket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Límite de mensajes excedido.", context.RequestAborted);
                    break;
                }

                try
                {
                    using var document = JsonDocument.Parse(buffer.AsMemory(0, result.Count));
                    var root = document.RootElement;
                    var type = root.TryGetProperty("tipo", out var typeProperty) ? typeProperty.GetString() : null;

                    // Todos los roles mantienen viva la conexion. El chat se publica por REST para
                    // conservar validacion e historial; el socket entrega las actualizaciones en vivo.
                    if (type == "ping")
                    {
                        await WebSocketConnectionManager.SendHeartbeatAsync(webSocket);
                        continue;
                    }

                    if (authRole != RolesUsuario.Piloto)
                    {
                        continue;
                    }

                    if (type is not ("telemetria" or "piloto_offline" or "logout"))
                    {
                        continue;
                    }

                    var hasTripId = root.TryGetProperty("idViaje", out var tripIdProperty);
                    if (hasTripId && (tripIdProperty.ValueKind != JsonValueKind.Number || !tripIdProperty.TryGetInt32(out var requestedId) || requestedId <= 0)) continue;
                    // El viaje (placa, ruta, destino y dispositivo autorizado) se relee como máximo cada
                    // 5 segundos, o antes si el teléfono anuncia otro viaje. Antes se consultaba la base
                    // de datos dos veces por cada lectura GPS recibida.
                    var requestedTripId = hasTripId ? tripIdProperty.GetInt32() : (int?)null;
                    if (now - activeTripCheckedAt > TripCacheDuration
                        || (requestedTripId.HasValue && requestedTripId != activeTrip?.Trip.IdViaje))
                    {
                        activeTripCheckedAt = now;
                        activeTrip = await db.ViajesDiarios
                            .AsNoTracking()
                            .Where(trip => trip.IdUsuario == authUserId && trip.EstadoViaje == EstadosViaje.EnCurso)
                            .Select(trip => new LiveTrip(
                                trip,
                                trip.IdAutobusNavigation.Placa,
                                trip.IdRutaNavigation != null ? trip.IdRutaNavigation.NombreRuta : "Sin ruta asignada"))
                            .SingleOrDefaultAsync(context.RequestAborted);
                    }

                    if (activeTrip is null)
                    {
                        continue;
                    }
                    if (requestedTripId.HasValue && requestedTripId != activeTrip.Trip.IdViaje) continue;
                    var source = root.TryGetProperty("idFuente", out var sourceProperty) && sourceProperty.ValueKind == JsonValueKind.String ? sourceProperty.GetString() : null;
                    var sourceTrip = activeTrip.Trip;
                    if (!TrackingSourcePolicy.MayPublish(sourceTrip, source)) continue;

                    if (type is "piloto_offline" or "logout"
                        || (root.TryGetProperty("isOffline", out var offlineProperty) && offlineProperty.ValueKind == JsonValueKind.True))
                    {
                        await WebSocketConnectionManager.BroadcastPilotOfflineAsync(
                            authUserId,
                            activeTrip.Plate,
                            authenticatedUser.NombreCompleto);
                        continue;
                    }

                    var isPrivacy = root.TryGetProperty("isPrivacyMode", out var privacyProperty)
                        && privacyProperty.ValueKind == JsonValueKind.True;
                    if (!TryReadDecimal(root, "latitud", out var latitude)
                        || !TryReadDecimal(root, "longitud", out var longitude)
                        || !TryReadDecimal(root, "velocidadKmh", out var speed)
                        || latitude is < -90 or > 90
                        || longitude is < -180 or > 180
                        || speed is < 0 or > 300)
                    {
                        continue;
                    }

                    decimal? destinationLatitude = TryReadDecimal(root, "destinoLat", out var dlat) && dlat is >= -90 and <= 90 ? dlat : null;
                    decimal? destinationLongitude = TryReadDecimal(root, "destinoLng", out var dlng) && dlng is >= -180 and <= 180 ? dlng : null;
                    var destinationName = root.TryGetProperty("destinoNombre", out var destinationProperty)
                        ? destinationProperty.GetString()?.Trim()
                        : null;

                    // Preserve observation time so delayed REST history cannot replace
                    // a newer live reading. Older clients without it use server time.
                    var observedAt = now;
                    if (root.TryGetProperty("fechaHoraDispositivo", out var timestampProperty))
                    {
                        if (timestampProperty.ValueKind != JsonValueKind.String
                            || !DateTimeOffset.TryParse(timestampProperty.GetString(), out var timestamp)) continue;
                        observedAt = timestamp.UtcDateTime;
                        if (observedAt < now.AddMinutes(-2) || observedAt > now.AddMinutes(5)) continue;
                    }

                    await WebSocketConnectionManager.BroadcastTelemetryAsync(new TelemetriaLiveDto
                    {
                        IdViaje = activeTrip.Trip.IdViaje,
                        Heading = TryReadDecimal(root, "heading", out var heading) && heading is >= 0 and < 360 ? heading : null,
                        PlacaAutobus = activeTrip.Plate,
                        NombrePiloto = authenticatedUser.NombreCompleto,
                        NombreRuta = activeTrip.Route,
                        VelocidadKmh = isPrivacy ? 0 : speed,
                        Latitud = isPrivacy ? 0 : latitude,
                        Longitud = isPrivacy ? 0 : longitude,
                        AceleracionX = ReadOptionalDecimal(root, "aceleracionX"),
                        AceleracionY = ReadOptionalDecimal(root, "aceleracionY"),
                        AceleracionZ = ReadOptionalDecimal(root, "aceleracionZ") ?? 9.8M,
                        GiroscopioX = ReadOptionalDecimal(root, "giroscopioX"),
                        GiroscopioY = ReadOptionalDecimal(root, "giroscopioY"),
                        GiroscopioZ = ReadOptionalDecimal(root, "giroscopioZ"),
                        DestinoLat = source != null ? sourceTrip.DestinoLatitud : destinationLatitude ?? sourceTrip.DestinoLatitud,
                        DestinoLng = source != null ? sourceTrip.DestinoLongitud : destinationLongitude ?? sourceTrip.DestinoLongitud,
                        DestinoNombre = source != null ? sourceTrip.DestinoNombre : destinationName is { Length: > 150 } ? destinationName[..150] : destinationName ?? sourceTrip.DestinoNombre,
                        IsTripActive = true,
                        IsPrivacyMode = isPrivacy,
                        FechaHoraDispositivo = observedAt
                    }, authUserId);
                }
                catch (JsonException)
                {
                    // Se descarta únicamente la trama JSON inválida; la conexión sigue disponible.
                }
            }
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // El cliente o servidor canceló la conexión.
        }
        catch (WebSocketException)
        {
            // La limpieza común elimina la conexión cerrada.
        }
        finally
        {
            WebSocketConnectionManager.RemoveSocket(webSocket);
        }
    }

    private static bool TryReadDecimal(JsonElement root, string propertyName, out decimal value)
    {
        value = 0;
        return root.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.Number
            && property.TryGetDecimal(out value);
    }

    private static decimal? ReadOptionalDecimal(JsonElement root, string propertyName) =>
        TryReadDecimal(root, propertyName, out var value) ? value : null;
}
