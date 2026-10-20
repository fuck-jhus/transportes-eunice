using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using webapi.Dtos;
using webapi.Services;
using webapi.Core;

namespace webapi.Controllers
{
    [ApiController]
    [Route(ApiRoutes.Telemetria)]
    [Authorize]
    public class TelemetriaController : ControllerBase
    {
        private readonly ITelemetriaService _telemetriaService;
        private readonly ILogger<TelemetriaController> _logger;
        private const int MaxBatchSize = 500;

        public TelemetriaController(ITelemetriaService telemetriaService, ILogger<TelemetriaController> logger)
        {
            _telemetriaService = telemetriaService ?? throw new ArgumentNullException(nameof(telemetriaService));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpGet("activas")]
        [HasPermission(AppPermissions.Telemetria.Consultar)]
        public IActionResult GetActivas()
        {
            return Ok(WebSocketConnectionManager.GetActiveTelemetry());
        }

        [HttpPost]
        [HasPermission(AppPermissions.Telemetria.Enviar)]
        public async Task<IActionResult> Post([FromBody] CrearTelemetriaDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (string.IsNullOrEmpty(idClaim) || !int.TryParse(idClaim, out int idPiloto))
                {
                    return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });
                }

                var processed = await _telemetriaService.RegistrarTelemetriaAsync(idPiloto, dto);
                return Ok(new
                {
                    mensaje = processed == 1
                        ? "Telemetría recibida e insertada correctamente."
                        : "La lectura ya había sido procesada o era anterior a la última posición.",
                    procesadas = processed
                });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al procesar la lectura de telemetría.");
                if (DatabaseConflicts.IsConflict(ex)) return Conflict(new { mensaje = ex is TrackingSourceConflictException ? ex.Message : DatabaseConflicts.Message });
                return StatusCode(500, new { mensaje = "Error al procesar la telemetría." });
            }
        }

        [HttpPost("batch")]
        [HasPermission(AppPermissions.Telemetria.Enviar)]
        public async Task<IActionResult> PostBatch([FromBody] IEnumerable<CrearTelemetriaDto> dtos)
        {
            if (!ModelState.IsValid || dtos == null)
            {
                return BadRequest(ModelState);
            }

            var dtoList = dtos.ToList();
            if (dtoList.Count == 0)
            {
                return BadRequest(new { mensaje = "El lote de telemetría no puede estar vacío." });
            }

            if (dtoList.Count > MaxBatchSize)
            {
                return BadRequest(new { mensaje = $"El tamaño del lote excede el límite permitido de {MaxBatchSize} registros." });
            }

            try
            {
                var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (string.IsNullOrEmpty(idClaim) || !int.TryParse(idClaim, out int idPiloto))
                {
                    return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });
                }

                var processed = await _telemetriaService.RegistrarTelemetriaBatchAsync(idPiloto, dtoList);
                return Ok(new
                {
                    mensaje = $"{processed} de {dtoList.Count} lecturas de telemetría fueron procesadas.",
                    procesadas = processed,
                    recibidas = dtoList.Count
                });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al procesar el lote de telemetría.");
                if (DatabaseConflicts.IsConflict(ex)) return Conflict(new { mensaje = ex is TrackingSourceConflictException ? ex.Message : DatabaseConflicts.Message });
                return StatusCode(500, new { mensaje = "Error al procesar el lote de telemetría." });
            }
        }

        [HttpPost("estado")]
        [HasPermission(AppPermissions.Telemetria.Enviar)]
        public async Task<IActionResult> UpdateStatus([FromBody] ActualizarEstadoTelemetriaDto dto)
        {
            try
            {
                var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (string.IsNullOrEmpty(idClaim) || !int.TryParse(idClaim, out int idPiloto))
                {
                    return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });
                }

                await _telemetriaService.ActualizarEstadoPilotoAsync(idPiloto, dto.IsPrivacyMode);
                return Ok(new
                {
                    mensaje = dto.IsPrivacyMode
                        ? "Transmisión de ubicación pausada."
                        : "Transmisión de ubicación reanudada."
                });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al actualizar el estado de telemetría del piloto.");
                return StatusCode(500, new { mensaje = "Error al actualizar el estado de telemetría." });
            }
        }
    }
}
