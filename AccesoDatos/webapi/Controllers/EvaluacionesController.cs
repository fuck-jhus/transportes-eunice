using System;
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
    [Route(ApiRoutes.Evaluaciones)]
    [Authorize]
    public class EvaluacionesController : ControllerBase
    {
        private readonly IEvaluacionService _evaluacionService;
        private readonly ILogger<EvaluacionesController> _logger;

        public EvaluacionesController(IEvaluacionService evaluacionService, ILogger<EvaluacionesController> logger)
        {
            _evaluacionService = evaluacionService ?? throw new ArgumentNullException(nameof(evaluacionService));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpGet]
        [HasPermission(AppPermissions.Telemetria.Consultar)]
        public async Task<IActionResult> Get([FromQuery] int? anio, [FromQuery] int? mes)
        {
            try
            {
                var evals = await _evaluacionService.GetEvaluacionesMensualesAsync(anio, mes);
                return Ok(evals);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener calificaciones mensuales.");
                return StatusCode(500, new { mensaje = "Error al obtener calificaciones mensuales." });
            }
        }

        [HttpPost("procesar")]
        [Authorize(Roles = "Administrador,SuperAdministrador")]
        public async Task<IActionResult> Procesar([FromBody] ProcesarEvaluacionDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                await _evaluacionService.ProcesarEvaluacionesMensualesAsync(dto.Anio, dto.Mes);
                return Ok(new { mensaje = $"Evaluación consolidada exitosamente para {dto.Anio}-{dto.Mes:D2}." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al consolidar las evaluaciones para el período {Anio}-{Mes}", dto.Anio, dto.Mes);
                return StatusCode(500, new { mensaje = "Error al consolidar las evaluaciones." });
            }
        }
    }
}
