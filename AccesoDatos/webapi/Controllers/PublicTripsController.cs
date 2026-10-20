using System.Text.Json;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using webapi.Core;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Controllers;

[ApiController]
[Route(ApiRoutes.ViajesPublicos)]
[AllowAnonymous]
[EnableRateLimiting("PublicReadRateLimit")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicTripsController : ControllerBase
{
    private const int MaxHistoryPoints = 160;
    private const int MaxProviderResponseBytes = 2 * 1024 * 1024;
    private readonly PrevencionAccidentesBusesContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<PublicTripsController> _logger;
    private readonly IPushNotificationService _pushNotifications;

    public PublicTripsController(
        PrevencionAccidentesBusesContext context,
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        ILogger<PublicTripsController> logger,
        IPushNotificationService? pushNotifications = null)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _logger = logger;
        _pushNotifications = pushNotifications ?? NullPushNotificationService.Instance;
    }

    [HttpGet("{token}")]
    public async Task<IActionResult> GetTrip(string token, CancellationToken cancellationToken)
    {
        var access = await ResolveAccessAsync(token, cancellationToken);
        if (access is null) return NotFound(new { mensaje = "El enlace no existe, venció o fue revocado." });

        var trip = access.IdViajeNavigation;
        var latest = await _context.TelemetriaIots.AsNoTracking()
            .Where(item => item.IdViaje == trip.IdViaje)
            .OrderByDescending(item => item.FechaHoraDispositivo)
            .Select(item => new PosicionPublicaDto
            {
                Latitud = item.Latitud,
                Longitud = item.Longitud,
                FechaHora = item.FechaHoraDispositivo
            })
            .FirstOrDefaultAsync(cancellationToken);

        var routeHistory = Array.Empty<PosicionPublicaDto>();
        if (!trip.ModoPrivacidad)
        {
            var newestFirst = await _context.TelemetriaIots.AsNoTracking()
                .Where(item => item.IdViaje == trip.IdViaje)
                .OrderByDescending(item => item.FechaHoraDispositivo)
                .Take(600)
                .Select(item => new PosicionPublicaDto
                {
                    Latitud = item.Latitud,
                    Longitud = item.Longitud,
                    FechaHora = item.FechaHoraDispositivo
                })
                .ToListAsync(cancellationToken);
            newestFirst.Reverse();
            routeHistory = Downsample(newestFirst, MaxHistoryPoints).ToArray();
        }

        var lastUpdate = latest?.FechaHora;
        var stale = !lastUpdate.HasValue || DateTime.UtcNow - EnsureUtc(lastUpdate.Value) > TimeSpan.FromSeconds(30)
            || EnsureUtc(lastUpdate.Value) > DateTime.UtcNow.AddSeconds(5);
        var route = trip.IdRutaNavigation;
        var driverFirstName = (trip.NombrePilotoSnapshot ?? trip.IdUsuarioNavigation.NombreCompleto ?? "Conductor")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault() ?? "Conductor";

        return Ok(new ViajePublicoDto
        {
            EstadoViaje = trip.EstadoViaje ?? "N/D",
            NombreRuta = trip.NombreRutaSnapshot ?? route?.NombreRuta ?? trip.DestinoNombre ?? "Recorrido en curso",
            Origen = trip.OrigenSnapshot ?? route?.Origen ?? "Punto de salida",
            Destino = trip.DestinoNombre ?? trip.DestinoSnapshot ?? route?.Destino ?? "Destino por confirmar",
            Unidad = trip.PlacaSnapshot ?? trip.IdAutobusNavigation.Placa,
            Conductor = driverFirstName,
            FechaInicio = trip.FechaInicio,
            FechaFin = trip.FechaFin,
            ChatHabilitado = access.ChatHabilitado && trip.EstadoViaje == "En Curso",
            ModoPrivacidad = trip.ModoPrivacidad,
            UbicacionDisponible = latest is not null && !trip.ModoPrivacidad,
            UbicacionDesactualizada = stale,
            PosicionActual = trip.ModoPrivacidad ? null : latest,
            DestinoLatitud = trip.DestinoLatitud,
            DestinoLongitud = trip.DestinoLongitud,
            DestinoNombre = trip.DestinoNombre ?? route?.Destino,
            Recorrido = routeHistory
        });
    }

    [HttpGet("{token}/ruta")]
    public async Task<IActionResult> GetRemainingRoute(string token, CancellationToken cancellationToken)
    {
        var access = await ResolveAccessAsync(token, cancellationToken);
        if (access is null) return NotFound(new { mensaje = "El enlace no existe, venció o fue revocado." });

        var trip = access.IdViajeNavigation;
        if (trip.ModoPrivacidad || !trip.DestinoLatitud.HasValue || !trip.DestinoLongitud.HasValue)
        {
            return NotFound(new { mensaje = "El viaje todavía no tiene una navegación pública disponible." });
        }

        var latest = await _context.TelemetriaIots.AsNoTracking()
            .Where(item => item.IdViaje == trip.IdViaje)
            .OrderByDescending(item => item.FechaHoraDispositivo)
            .Select(item => new { item.Latitud, item.Longitud, item.FechaHoraDispositivo })
            .FirstOrDefaultAsync(cancellationToken);
        if (latest is null) return NotFound(new { mensaje = "Aún no hay una posición disponible." });

        var cacheKey = $"public-route:{trip.IdViaje}:{Math.Round(latest.Latitud, 3)}:{Math.Round(latest.Longitud, 3)}:{trip.DestinoLatitud}:{trip.DestinoLongitud}";
        if (_cache.TryGetValue<RutaPublicaDto>(cacheKey, out var cached) && cached is not null)
        {
            return Ok(cached);
        }

        var points = FormattableString.Invariant($"{latest.Longitud},{latest.Latitud};{trip.DestinoLongitud},{trip.DestinoLatitud}");
        var osrmPath = $"route/v1/driving/{points}?overview=full&geometries=geojson&steps=false&alternatives=false";
        foreach (var provider in new[] { "Osrm", "OsrmFallback" })
        {
            var json = await TryDownloadProviderJsonAsync(provider, osrmPath, cancellationToken);
            if (json is null) continue;
            try
            {
                using var document = JsonDocument.Parse(json);
                var firstRoute = document.RootElement.GetProperty("routes").EnumerateArray().FirstOrDefault();
                if (firstRoute.ValueKind == JsonValueKind.Undefined) continue;

                var result = new RutaPublicaDto
                {
                    Coordenadas = ReadCoordinates(firstRoute.GetProperty("geometry")),
                    DistanciaKm = Math.Round(firstRoute.GetProperty("distance").GetDecimal() / 1000M, 1),
                    DuracionMinutos = Math.Round(firstRoute.GetProperty("duration").GetDecimal() / 60M, 0)
                };
                _cache.Set(cacheKey, result, TimeSpan.FromSeconds(30));
                return Ok(result);
            }
            catch (Exception exception) when (exception is JsonException or InvalidOperationException or KeyNotFoundException)
            {
                _logger.LogWarning(exception, "Proveedor público {Provider} devolvió una ruta inválida.", provider);
            }
        }

        var bRouterPoints = points.Replace(';', '|');
        var bRouterPath = $"brouter?lonlats={Uri.EscapeDataString(bRouterPoints)}&profile=car-fast&format=geojson";
        var bRouterJson = await TryDownloadProviderJsonAsync("BRouter", bRouterPath, cancellationToken);
        if (bRouterJson is not null)
        {
            try
            {
                using var document = JsonDocument.Parse(bRouterJson);
                var root = document.RootElement;
                var feature = root.TryGetProperty("features", out var features)
                    && features.ValueKind == JsonValueKind.Array
                    && features.GetArrayLength() > 0
                        ? features[0]
                        : root;
                var properties = feature.TryGetProperty("properties", out var propertyNode)
                    ? propertyNode
                    : default;
                var result = new RutaPublicaDto
                {
                    Coordenadas = ReadCoordinates(feature.GetProperty("geometry")),
                    DistanciaKm = Math.Round((ReadDecimal(properties, "track-length")
                        ?? ReadDecimal(properties, "total-length")
                        ?? ReadDecimal(properties, "distance")
                        ?? 0M) / 1000M, 1),
                    DuracionMinutos = Math.Round((ReadDecimal(properties, "total-time")
                        ?? ReadDecimal(properties, "duration")
                        ?? 0M) / 60M, 0)
                };
                _cache.Set(cacheKey, result, TimeSpan.FromSeconds(30));
                return Ok(result);
            }
            catch (Exception exception) when (exception is JsonException or InvalidOperationException or KeyNotFoundException)
            {
                _logger.LogWarning(exception, "BRouter devolvió una ruta pública inválida para el viaje {TripId}.", trip.IdViaje);
            }
        }

        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            mensaje = "No fue posible calcular el recorrido restante. Intenta nuevamente en unos segundos."
        });
    }

    [HttpPost("{token}/sesion")]
    [EnableRateLimiting("PublicChatSessionRateLimit")]
    public async Task<IActionResult> StartSession(
        string token,
        [FromBody] IniciarSesionPasajeroDto dto,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAccessAsync(token, cancellationToken);
        if (access is null) return NotFound(new { mensaje = "El enlace no existe, venció o fue revocado." });
        if (!access.ChatHabilitado || access.IdViajeNavigation.EstadoViaje != "En Curso")
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "La mensajería de este viaje no está disponible." });
        }

        var sessionToken = Request.Cookies.TryGetValue(PublicTripToken.GuestCookieName, out var currentSession)
            && PublicTripToken.IsValid(currentSession)
                ? currentSession
                : PublicTripToken.Create();
        var sessionHash = PublicTripToken.Hash(sessionToken);
        var conversation = await _context.ConversacionesPasajeros
            .SingleOrDefaultAsync(item => item.IdAcceso == access.IdAcceso && item.SesionHash == sessionHash, cancellationToken);

        if (conversation is null)
        {
            conversation = new ConversacionPasajero
            {
                IdConversacion = Guid.NewGuid(),
                IdAcceso = access.IdAcceso,
                SesionHash = sessionHash,
                FechaCreacion = DateTime.UtcNow,
                FechaUltimaActividad = DateTime.UtcNow
            };
            conversation.AliasPasajero = PublicTripToken.NormalizeAlias(dto.Alias, conversation.IdConversacion);
            _context.ConversacionesPasajeros.Add(conversation);
        }
        else if (!string.IsNullOrWhiteSpace(dto.Alias))
        {
            conversation.AliasPasajero = PublicTripToken.NormalizeAlias(dto.Alias, conversation.IdConversacion);
        }

        await _context.SaveChangesAsync(cancellationToken);
        Response.Cookies.Append(PublicTripToken.GuestCookieName, sessionToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/" + ApiRoutes.ViajesPublicos,
            Expires = access.FechaExpiracion
        });

        return Ok(new SesionPasajeroDto
        {
            IdConversacion = conversation.IdConversacion,
            Alias = conversation.AliasPasajero,
            Bloqueada = conversation.Bloqueada
        });
    }

    [HttpGet("{token}/mensajes")]
    [EnableRateLimiting("PublicChatReadRateLimit")]
    public async Task<IActionResult> GetMessages(string token, CancellationToken cancellationToken, [FromQuery] Guid? antes = null)
    {
        var conversation = await ResolveConversationAsync(token, cancellationToken);
        if (conversation is null) return Unauthorized(new { mensaje = "Inicia la conversación desde este dispositivo." });

        return Ok(await ReadMessagesAsync(conversation.IdConversacion, cancellationToken, antes));
    }

    [HttpPost("{token}/leido")]
    [EnableRateLimiting("PublicChatWriteRateLimit")]
    public async Task<IActionResult> Acknowledge(string token, PassengerReadReceiptDto dto, CancellationToken cancellationToken)
    {
        var conversation = await ResolveConversationAsync(token, cancellationToken);
        if (conversation == null) return Unauthorized();
        var messages = await _context.MensajesPasajeros.Where(x => x.IdConversacion == conversation.IdConversacion
            && dto.IdsMensaje.Contains(x.IdMensaje) && x.TipoEmisor != "Pasajero" && x.FechaLectura == null).ToListAsync(cancellationToken);
        foreach (var message in messages) message.FechaLectura = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new { confirmados = messages.Count });
    }

    [HttpPost("{token}/mensajes")]
    [EnableRateLimiting("PublicChatWriteRateLimit")]
    public async Task<IActionResult> SendMessage(
        string token,
        [FromBody] EnviarMensajePasajeroDto dto,
        CancellationToken cancellationToken)
    {
        var conversation = await ResolveConversationAsync(token, cancellationToken, requireActiveTrip: true);
        if (conversation is null) return Unauthorized(new { mensaje = "La sesión de mensajería no es válida o el viaje finalizó." });
        if (conversation.Bloqueada) return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "Esta conversación fue bloqueada por administración." });

        var content = PublicTripToken.NormalizeMessage(dto.Contenido);
        if (string.IsNullOrWhiteSpace(content)) return BadRequest(new { mensaje = "El mensaje no puede estar vacío." });
        if (!ContentModeration.IsAllowed(content))
        {
            return BadRequest(new
            {
                mensaje = "El mensaje contiene lenguaje no permitido. Modifícalo antes de enviarlo."
            });
        }

        if (!string.IsNullOrWhiteSpace(dto.IdCliente))
        {
            var previous = await _context.MensajesPasajeros.AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdConversacion == conversation.IdConversacion && item.IdCliente == dto.IdCliente, cancellationToken);
            if (previous is not null) return previous.TipoEmisor == "Pasajero" && previous.Contenido == content
                ? Ok(ToMessageDto(previous)) : Conflict(new { mensaje = "El identificador de envío ya corresponde a otro contenido." });
        }

        var message = new MensajePasajero
        {
            IdMensaje = Guid.NewGuid(),
            IdConversacion = conversation.IdConversacion,
            TipoEmisor = "Pasajero",
            NombreEmisor = conversation.AliasPasajero,
            Contenido = content,
            IdCliente = dto.IdCliente,
            FechaHora = DateTime.UtcNow
        };
        conversation.FechaUltimaActividad = message.FechaHora;
        var trip = conversation.IdAccesoNavigation.IdViajeNavigation;
        await PushOutbox.AddAsync(_context, $"passenger-message:{message.IdMensaje}", "Mensaje de pasajero",
            $"{conversation.AliasPasajero}: {content}", new Dictionary<string, string?>
            { ["type"] = "passenger_message", ["tab"] = "chat", ["tripId"] = trip.IdViaje.ToString(),
                ["conversationId"] = conversation.IdConversacion.ToString() },
            [trip.IdUsuario], PushOutbox.Operators, ct: cancellationToken);
        _context.MensajesPasajeros.Add(message);
        try { await _context.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException) when (!string.IsNullOrWhiteSpace(dto.IdCliente))
        {
            _context.Entry(message).State = EntityState.Detached;
            var existing = await _context.MensajesPasajeros.AsNoTracking().SingleOrDefaultAsync(x => x.IdConversacion == conversation.IdConversacion && x.IdCliente == dto.IdCliente, cancellationToken);
            if (existing == null) throw;
            return existing.TipoEmisor == "Pasajero" && existing.Contenido == content ? Ok(ToMessageDto(existing))
                : Conflict(new { mensaje = "El identificador de envío ya corresponde a otro contenido." });
        }

        var response = ToMessageDto(message);
        await WebSocketConnectionManager.BroadcastPassengerMessageAsync(
            response,
            conversation.IdAccesoNavigation.IdViajeNavigation.IdUsuario);

        return Ok(response);
    }

    private async Task<byte[]?> TryDownloadProviderJsonAsync(
        string clientName,
        string path,
        CancellationToken cancellationToken)
    {
        try
        {
            var client = _httpClientFactory.CreateClient(clientName);
            using var response = await client.GetAsync(path, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Proveedor público {Provider} respondió {StatusCode}; se probará el siguiente.", clientName, response.StatusCode);
                return null;
            }

            if (response.Content.Headers.ContentLength > MaxProviderResponseBytes) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var payload = new MemoryStream();
            var buffer = new byte[8192];
            while (true)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
                if (read == 0) break;
                if (payload.Length + read > MaxProviderResponseBytes) return null;
                await payload.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }

            var json = payload.ToArray();
            using var _ = JsonDocument.Parse(json);
            return json;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("Proveedor público {Provider} agotó el tiempo de espera.", clientName);
            return null;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException)
        {
            _logger.LogWarning(exception, "No fue posible consultar el proveedor público {Provider}.", clientName);
            return null;
        }
    }

    private static decimal[][] ReadCoordinates(JsonElement geometry) =>
        geometry.GetProperty("coordinates")
            .EnumerateArray()
            .Select(point => new[] { point[1].GetDecimal(), point[0].GetDecimal() })
            .ToArray();

    private static decimal? ReadDecimal(JsonElement source, string propertyName) =>
        source.ValueKind == JsonValueKind.Object
        && source.TryGetProperty(propertyName, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetDecimal(out var number)
            ? number
            : null;

    [HttpGet("{token}/notificaciones")]
    public async Task<IActionResult> GetPushStatus(string token, [FromServices] GuestWebPushService service, CancellationToken cancellationToken)
    {
        var conversation = await ResolveConversationAsync(token, cancellationToken, requireActiveTrip: true);
        if (conversation == null || conversation.Bloqueada) return NotFound();
        var keys = await service.GetKeysAsync(cancellationToken);
        var subscribed = await _context.GuestPushSubscriptions.AnyAsync(x => x.ConversationId == conversation.IdConversacion
            && x.Active && x.ExpiresAt > DateTime.UtcNow, cancellationToken);
        return Ok(new { keys.PublicKey, subscribed });
    }

    [HttpPost("{token}/notificaciones")]
    [EnableRateLimiting("ChatRateLimit")]
    public async Task<IActionResult> SubscribePush(string token, GuestPushSubscriptionDto dto,
        [FromServices] GuestWebPushService service, CancellationToken cancellationToken)
    {
        var conversation = await ResolveConversationAsync(token, cancellationToken, requireActiveTrip: true);
        if (conversation == null || conversation.Bloqueada) return NotFound();
        if (!GuestWebPushService.ValidEndpoint(dto.Endpoint) || !GuestWebPushService.ValidKeys(dto.Keys.P256dh, dto.Keys.Auth))
            return BadRequest(new { mensaje = "La suscripción del navegador no es válida." });
        await service.SubscribeAsync(conversation.IdConversacion, token, conversation.IdAccesoNavigation.FechaExpiracion,
            dto.Endpoint, dto.Keys.P256dh, dto.Keys.Auth, cancellationToken);
        return Ok(new { mensaje = "Notificaciones de esta conversación activadas." });
    }

    [HttpDelete("{token}/notificaciones")]
    public async Task<IActionResult> UnsubscribePush(string token, CancellationToken cancellationToken)
    {
        var conversation = await ResolveConversationAsync(token, cancellationToken);
        if (conversation == null) return NotFound();
        var subscriptions = await _context.GuestPushSubscriptions.Where(x => x.ConversationId == conversation.IdConversacion).ToListAsync(cancellationToken);
        foreach (var subscription in subscriptions) subscription.Active = false;
        await _context.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private async Task<ViajeAccesoPublico?> ResolveAccessAsync(string token, CancellationToken cancellationToken)
    {
        if (!PublicTripToken.IsValid(token)) return null;
        var hash = PublicTripToken.Hash(token);
        var now = DateTime.UtcNow;
        var access = await _context.ViajesAccesosPublicos
            .Include(item => item.IdViajeNavigation).ThenInclude(item => item.IdAutobusNavigation)
            .Include(item => item.IdViajeNavigation).ThenInclude(item => item.IdUsuarioNavigation)
            .Include(item => item.IdViajeNavigation).ThenInclude(item => item.IdRutaNavigation)
            .SingleOrDefaultAsync(item => item.TokenHash == hash
                && item.FechaRevocacion == null
                && item.FechaExpiracion > now, cancellationToken);
        if (access?.IdViajeNavigation.FechaFin is DateTime endedAt
            && now - EnsureUtc(endedAt) > TimeSpan.FromMinutes(30))
        {
            return null;
        }
        return access;
    }

    private async Task<ConversacionPasajero?> ResolveConversationAsync(
        string token,
        CancellationToken cancellationToken,
        bool requireActiveTrip = false)
    {
        var access = await ResolveAccessAsync(token, cancellationToken);
        if (access is null || !access.ChatHabilitado) return null;
        if (requireActiveTrip && access.IdViajeNavigation.EstadoViaje != "En Curso") return null;
        if (!Request.Cookies.TryGetValue(PublicTripToken.GuestCookieName, out var sessionToken)
            || !PublicTripToken.IsValid(sessionToken)) return null;

        var hash = PublicTripToken.Hash(sessionToken);
        return await _context.ConversacionesPasajeros
            .Include(item => item.IdAccesoNavigation).ThenInclude(item => item.IdViajeNavigation)
            .SingleOrDefaultAsync(item => item.IdAcceso == access.IdAcceso && item.SesionHash == hash, cancellationToken);
    }

    private async Task<List<MensajePasajeroDto>> ReadMessagesAsync(Guid conversationId, CancellationToken cancellationToken, Guid? before = null)
    {
        var query = _context.MensajesPasajeros.AsNoTracking().Where(item => item.IdConversacion == conversationId);
        if (before.HasValue) {
            var cursor = await query.SingleOrDefaultAsync(x => x.IdMensaje == before.Value, cancellationToken);
            if (cursor == null) return [];
            query = query.Where(x => x.FechaHora < cursor.FechaHora || (x.FechaHora == cursor.FechaHora && x.IdMensaje.CompareTo(cursor.IdMensaje) < 0));
        }
        var messages = await query
            .OrderByDescending(item => item.FechaHora)
            .ThenByDescending(item => item.IdMensaje)
            .Take(200)
            .Select(item => new MensajePasajeroDto
            {
                IdMensaje = item.IdMensaje,
                IdConversacion = item.IdConversacion,
                TipoEmisor = item.TipoEmisor,
                NombreEmisor = item.TipoEmisor == "Pasajero" ? item.NombreEmisor : item.TipoEmisor == "Piloto" ? "Conductor" : "Centro de control",
                Contenido = item.Contenido,
                IdCliente = item.IdCliente,
                FechaHora = item.FechaHora,
                FechaLectura = item.FechaLectura
            })
            .ToListAsync(cancellationToken);
        messages.Reverse();
        return messages;
    }

    private static IEnumerable<PosicionPublicaDto> Downsample(IReadOnlyList<PosicionPublicaDto> points, int maxPoints)
    {
        if (points.Count <= maxPoints) return points;
        var step = (double)(points.Count - 1) / (maxPoints - 1);
        return Enumerable.Range(0, maxPoints)
            .Select(index => points[(int)Math.Round(index * step)])
            .DistinctBy(point => point.FechaHora);
    }

    private static DateTime EnsureUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static MensajePasajeroDto ToMessageDto(MensajePasajero item) => new()
    {
        IdMensaje = item.IdMensaje,
        IdConversacion = item.IdConversacion,
        TipoEmisor = item.TipoEmisor,
        NombreEmisor = item.TipoEmisor == "Pasajero" ? item.NombreEmisor : item.TipoEmisor == "Piloto" ? "Conductor" : "Centro de control",
        Contenido = item.Contenido,
        IdCliente = item.IdCliente,
        FechaHora = item.FechaHora,
        FechaLectura = item.FechaLectura
    };
}
