using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using webapi.Core;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Controllers;

[ApiController, Authorize, Route("api/telemetria/delivery")]
public class TelemetryDeliveryController(ITelemetriaService telemetry) : ControllerBase
{
    [HttpPost, HasPermission(AppPermissions.Telemetria.Enviar)]
    public async Task<IActionResult> Deliver(JsonElement body)
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var pilot)) return Unauthorized();
        if (body.ValueKind != JsonValueKind.Array || body.GetArrayLength() is < 1 or > 100) return BadRequest();
        var receipts = new List<TelemetryReceipt>();
        var valid = new List<CrearTelemetriaDto>();
        foreach (var element in body.EnumerateArray())
        {
            var id = element.ValueKind == JsonValueKind.Object && element.TryGetProperty("idLectura", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
            try
            {
                var dto = element.Deserialize<CrearTelemetriaDto>(new JsonSerializerOptions(JsonSerializerDefaults.Web));
                if (dto == null || string.IsNullOrWhiteSpace(id) || !dto.IdViaje.HasValue)
                    throw new InvalidOperationException("Cada posición necesita identidad y viaje.");
                Validator.ValidateObject(dto, new ValidationContext(dto), true);
                valid.Add(dto);
            }
            catch (Exception ex) when (ex is ValidationException or InvalidOperationException or JsonException)
            {
                receipts.Add(new(id, "rechazada", "REVISAR_LECTURA", ex.Message));
            }
        }
        try { receipts.AddRange((await telemetry.RegistrarDeliveryAsync(pilot, valid)).Lecturas); }
        catch (TrackingSourceConflictException ex) { return Conflict(new { mensaje = ex.Message, codigo = "OTRA_FUENTE" }); }
        return Ok(new TelemetryBatchReceipt(receipts));
    }
}
