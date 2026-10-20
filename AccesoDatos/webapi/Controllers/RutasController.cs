using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using webapi.Dtos;
using webapi.Services;
using webapi.Core;

namespace webapi.Controllers
{
    [ApiController]
    [Route(ApiRoutes.Rutas)]
    [Authorize]
    public class RutasController : ControllerBase
    {
        private readonly IRutaService _rutaService;
        private readonly ILogger<RutasController> _logger;

        public RutasController(IRutaService rutaService, ILogger<RutasController> logger)
        {
            _rutaService = rutaService ?? throw new ArgumentNullException(nameof(rutaService));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpGet]
        [HasPermission(AppPermissions.Rutas.Consultar)]
        public async Task<IActionResult> GetAll()
        {
            try
            {
                var rutas = await _rutaService.GetRutasAsync();
                return Ok(rutas);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener la lista de rutas.");
                return StatusCode(500, new { mensaje = "Error al obtener la lista de rutas." });
            }
        }

        [HttpGet("{id:int}")]
        [HasPermission(AppPermissions.Rutas.Consultar)]
        public async Task<IActionResult> GetById(int id)
        {
            try
            {
                var ruta = await _rutaService.GetRutaByIdAsync(id);
                if (ruta == null)
                {
                    return NotFound(new { mensaje = $"Ruta con ID {id} no encontrada." });
                }
                return Ok(ruta);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al consultar la ruta con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al consultar la ruta." });
            }
        }

        [HttpPost]
        [HasPermission(AppPermissions.Rutas.Crear)]
        public async Task<IActionResult> Create([FromBody] CrearRutaDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var nuevaRuta = await _rutaService.CrearRutaAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = nuevaRuta.IdRuta }, nuevaRuta);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al crear la ruta.");
                return StatusCode(500, new { mensaje = "Error al crear la ruta." });
            }
        }

        [HttpPut("{id:int}")]
        [HasPermission(AppPermissions.Rutas.Editar)]
        public async Task<IActionResult> Edit(int id, [FromBody] EditarRutaDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var rutaEditada = await _rutaService.EditarRutaAsync(id, dto);
                if (rutaEditada == null)
                {
                    return NotFound(new { mensaje = $"Ruta con ID {id} no existe." });
                }
                return Ok(rutaEditada);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al actualizar la ruta con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al actualizar la ruta." });
            }
        }

        [HttpDelete("{id:int}")]
        [HasPermission(AppPermissions.Rutas.Eliminar)]
        public async Task<IActionResult> Delete(int id)
        {
            try
            {
                var eliminado = await _rutaService.EliminarRutaAsync(id);
                if (!eliminado)
                {
                    return NotFound(new { mensaje = $"Ruta con ID {id} no existe." });
                }
                return Ok(new { mensaje = "Ruta eliminada exitosamente." });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al eliminar la ruta con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al eliminar la ruta." });
            }
        }
    }
}
