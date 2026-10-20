using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Memory;
using webapi.Core;

namespace webapi.Controllers;

[ApiController]
[Route(ApiRoutes.Mapas)]
[Authorize]
[EnableRateLimiting("MapsRateLimit")]
public class MapasController : ControllerBase
{
    private const int MaxProviderResponseBytes = 2 * 1024 * 1024;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<MapasController> _logger;

    public MapasController(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        ILogger<MapasController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _logger = logger;
    }

    [HttpGet("reversa")]
    public async Task<IActionResult> Reverse(
        [FromQuery, Range(-90, 90)] decimal lat,
        [FromQuery, Range(-180, 180)] decimal lng,
        CancellationToken cancellationToken)
    {
        var latitude = lat.ToString(CultureInfo.InvariantCulture);
        var longitude = lng.ToString(CultureInfo.InvariantCulture);
        var path = $"reverse?lat={latitude}&lon={longitude}&format=json&zoom=18&addressdetails=1";
        return await ProxyJsonAsync("Nominatim", path, $"reverse:{latitude}:{longitude}", TimeSpan.FromHours(12), cancellationToken);
    }

    [HttpGet("buscar")]
    public async Task<IActionResult> Search(
        [FromQuery, Required, StringLength(120, MinimumLength = 3)] string consulta,
        CancellationToken cancellationToken)
    {
        var normalized = consulta.Trim();
        var path = $"search?q={Uri.EscapeDataString(normalized)}&format=json&addressdetails=1&limit=10&countrycodes=gt";
        return await ProxyJsonAsync("Nominatim", path, $"search:{normalized.ToLowerInvariant()}", TimeSpan.FromHours(6), cancellationToken);
    }

    [HttpGet("ruta")]
    public async Task<IActionResult> Route(
        [FromQuery, Required, StringLength(200)] string puntos,
        [FromQuery] bool alternativas,
        CancellationToken cancellationToken)
    {
        if (!MapRequestValidator.TryNormalizePoints(puntos, ';', 3, out var normalized))
        {
            return BadRequest(new { mensaje = "Las coordenadas de la ruta no son válidas." });
        }

        var path = $"route/v1/driving/{normalized}?overview=full&geometries=geojson&steps=true&continue_straight=true&alternatives={alternativas.ToString().ToLowerInvariant()}";
        var cacheKey = $"route:{normalized}:{alternativas}";
        if (_cache.TryGetValue<string>(cacheKey, out var cachedJson) && cachedJson is not null)
        {
            return Content(cachedJson, "application/json");
        }

        // Los servicios públicos de ruteo no ofrecen SLA. Se prueba un espejo OSRM,
        // la instancia de referencia y finalmente BRouter sin exponer fallos intermedios
        // al navegador.
        foreach (var provider in new[] { "Osrm", "OsrmFallback" })
        {
            var json = await TryDownloadJsonAsync(provider, path, cancellationToken);
            if (json is null) continue;

            _cache.Set(cacheKey, json, TimeSpan.FromMinutes(10));
            return Content(json, "application/json");
        }

        var bRouterPoints = normalized.Replace(';', '|');
        var bRouterPath = $"brouter?lonlats={Uri.EscapeDataString(bRouterPoints)}&profile=car-fast&format=geojson";
        var bRouterJson = await TryDownloadJsonAsync("BRouter", bRouterPath, cancellationToken);
        if (bRouterJson is not null && TryConvertBRouterToOsrm(bRouterJson, out var convertedJson))
        {
            _cache.Set(cacheKey, convertedJson, TimeSpan.FromMinutes(10));
            return Content(convertedJson, "application/json");
        }

        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            mensaje = "No fue posible calcular la ruta en este momento. Intenta nuevamente en unos segundos."
        });
    }

    [HttpGet("ruta-alternativa")]
    public async Task<IActionResult> AlternativeRoute(
        [FromQuery, Required, StringLength(200)] string puntos,
        CancellationToken cancellationToken)
    {
        if (!MapRequestValidator.TryNormalizePoints(puntos, '|', 3, out var normalized))
        {
            return BadRequest(new { mensaje = "Las coordenadas de la ruta alternativa no son válidas." });
        }

        var path = $"brouter?lonlats={Uri.EscapeDataString(normalized)}&profile=car-fast&format=geojson";
        return await ProxyJsonAsync("BRouter", path, $"brouter:{normalized}", TimeSpan.FromMinutes(10), cancellationToken);
    }

    private async Task<IActionResult> ProxyJsonAsync(
        string clientName,
        string path,
        string cacheKey,
        TimeSpan cacheDuration,
        CancellationToken cancellationToken)
    {
        if (_cache.TryGetValue<string>(cacheKey, out var cachedJson) && cachedJson is not null)
        {
            return Content(cachedJson, "application/json");
        }

        try
        {
            var client = _httpClientFactory.CreateClient(clientName);
            using var response = await client.GetAsync(path, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Proveedor cartográfico {Provider} respondió {StatusCode}.", clientName, response.StatusCode);
                return StatusCode(StatusCodes.Status502BadGateway, new { mensaje = "El servicio cartográfico no está disponible temporalmente." });
            }

            var contentLength = response.Content.Headers.ContentLength;
            if (contentLength > MaxProviderResponseBytes)
            {
                return StatusCode(StatusCodes.Status502BadGateway, new { mensaje = "La respuesta cartográfica excedió el tamaño permitido." });
            }

            await using var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var payload = new MemoryStream();
            var buffer = new byte[8192];
            while (true)
            {
                var read = await responseStream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
                if (read == 0) break;
                if (payload.Length + read > MaxProviderResponseBytes)
                {
                    return StatusCode(StatusCodes.Status502BadGateway, new { mensaje = "La respuesta cartográfica excedió el tamaño permitido." });
                }
                await payload.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }

            var jsonBytes = payload.ToArray();
            try
            {
                using var _ = JsonDocument.Parse(jsonBytes);
            }
            catch (JsonException exception)
            {
                _logger.LogWarning(exception, "Proveedor cartográfico {Provider} devolvió una respuesta no válida.", clientName);
                return StatusCode(StatusCodes.Status502BadGateway, new { mensaje = "El servicio cartográfico devolvió una respuesta inválida." });
            }

            var json = Encoding.UTF8.GetString(jsonBytes);
            _cache.Set(cacheKey, json, cacheDuration);
            return Content(json, "application/json");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status504GatewayTimeout, new { mensaje = "El servicio cartográfico tardó demasiado en responder." });
        }
        catch (HttpRequestException exception)
        {
            _logger.LogWarning(exception, "No fue posible consultar el proveedor cartográfico {Provider}.", clientName);
            return StatusCode(StatusCodes.Status502BadGateway, new { mensaje = "El servicio cartográfico no está disponible temporalmente." });
        }
    }

    private async Task<string?> TryDownloadJsonAsync(
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
                _logger.LogWarning("Proveedor cartográfico {Provider} respondió {StatusCode}; se probará el siguiente.", clientName, response.StatusCode);
                return null;
            }

            if (response.Content.Headers.ContentLength > MaxProviderResponseBytes)
            {
                _logger.LogWarning("Proveedor cartográfico {Provider} excedió el tamaño permitido.", clientName);
                return null;
            }

            await using var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var payload = new MemoryStream();
            var buffer = new byte[8192];
            while (true)
            {
                var read = await responseStream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
                if (read == 0) break;
                if (payload.Length + read > MaxProviderResponseBytes)
                {
                    _logger.LogWarning("Proveedor cartográfico {Provider} excedió el tamaño permitido.", clientName);
                    return null;
                }

                await payload.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }

            var jsonBytes = payload.ToArray();
            using var _ = JsonDocument.Parse(jsonBytes);
            return Encoding.UTF8.GetString(jsonBytes);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("Proveedor cartográfico {Provider} excedió el tiempo de espera; se probará el siguiente.", clientName);
            return null;
        }
        catch (HttpRequestException exception)
        {
            _logger.LogWarning(exception, "No fue posible consultar {Provider}; se probará el siguiente.", clientName);
            return null;
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "Proveedor cartográfico {Provider} devolvió JSON inválido.", clientName);
            return null;
        }
    }

    private static bool TryConvertBRouterToOsrm(string sourceJson, out string convertedJson)
    {
        convertedJson = string.Empty;
        try
        {
            using var document = JsonDocument.Parse(sourceJson);
            var root = document.RootElement;
            JsonElement feature;
            if (root.TryGetProperty("features", out var features)
                && features.ValueKind == JsonValueKind.Array
                && features.GetArrayLength() > 0)
            {
                feature = features[0];
            }
            else if (root.ValueKind == JsonValueKind.Object)
            {
                feature = root;
            }
            else
            {
                return false;
            }

            if (!feature.TryGetProperty("geometry", out var geometry)
                || geometry.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            var distance = 0d;
            var duration = 0d;
            if (feature.TryGetProperty("properties", out var properties)
                && properties.ValueKind == JsonValueKind.Object)
            {
                distance = ReadNumber(properties, "track-length")
                    ?? ReadNumber(properties, "total-length")
                    ?? ReadNumber(properties, "distance")
                    ?? 0d;
                duration = ReadNumber(properties, "total-time")
                    ?? ReadNumber(properties, "duration")
                    ?? 0d;
            }

            convertedJson = JsonSerializer.Serialize(new
            {
                code = "Ok",
                routes = new[]
                {
                    new
                    {
                        distance,
                        duration,
                        geometry = geometry.Clone(),
                        legs = Array.Empty<object>()
                    }
                },
                waypoints = Array.Empty<object>()
            });
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static double? ReadNumber(JsonElement source, string propertyName) =>
        source.TryGetProperty(propertyName, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetDouble(out var number)
            ? number
            : null;
}
