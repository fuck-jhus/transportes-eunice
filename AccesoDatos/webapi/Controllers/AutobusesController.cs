using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using webapi.Dtos;
using webapi.Services;
using webapi.Core;

namespace webapi.Controllers
{
    [ApiController]
    [Route(ApiRoutes.Autobuses)]
    [Authorize]
    public class AutobusesController : ControllerBase
    {
        private readonly IAutobusService _autobusService;
        private readonly ILogger<AutobusesController> _logger;

        public AutobusesController(IAutobusService autobusService, ILogger<AutobusesController> logger)
        {
            _autobusService = autobusService ?? throw new ArgumentNullException(nameof(autobusService));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpGet]
        [HasPermission(AppPermissions.Autobuses.Consultar)]
        public async Task<IActionResult> GetAll()
        {
            try
            {
                var autobuses = await _autobusService.GetAutobusesAsync();
                return Ok(autobuses);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener la lista de autobuses.");
                return StatusCode(500, new { mensaje = "Error al obtener la lista de autobuses." });
            }
        }

        [HttpGet("{id:int}")]
        [HasPermission(AppPermissions.Autobuses.Consultar)]
        public async Task<IActionResult> GetById(int id)
        {
            try
            {
                var autobus = await _autobusService.GetAutobusByIdAsync(id);
                if (autobus == null)
                {
                    return NotFound(new { mensaje = $"Autobús con ID {id} no encontrado." });
                }
                return Ok(autobus);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al consultar el autobús con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al consultar el autobús." });
            }
        }

        [HttpPost]
        [HasPermission(AppPermissions.Autobuses.Crear)]
        public async Task<IActionResult> Create([FromBody] CrearAutobusDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var nuevoAutobus = await _autobusService.CrearAutobusAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = nuevoAutobus.IdAutobus }, nuevoAutobus);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al crear el autobús.");
                if (DatabaseConflicts.IsConflict(ex)) return Conflict(new { mensaje = DatabaseConflicts.Message });
                return StatusCode(500, new { mensaje = "Error al crear el autobús." });
            }
        }

        [HttpPut("{id:int}")]
        [HasPermission(AppPermissions.Autobuses.Editar)]
        public async Task<IActionResult> Edit(int id, [FromBody] EditarAutobusDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var autobusEditado = await _autobusService.EditarAutobusAsync(id, dto);
                if (autobusEditado == null)
                {
                    return NotFound(new { mensaje = $"Autobús con ID {id} no existe." });
                }
                return Ok(autobusEditado);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al actualizar el autobús con ID {Id}", id);
                if (DatabaseConflicts.IsConflict(ex)) return Conflict(new { mensaje = DatabaseConflicts.Message });
                return StatusCode(500, new { mensaje = "Error al actualizar el autobús." });
            }
        }

        [HttpDelete("{id:int}")]
        [HasPermission(AppPermissions.Autobuses.Eliminar)]
        public async Task<IActionResult> Delete(int id)
        {
            try
            {
                var eliminado = await _autobusService.EliminarAutobusAsync(id);
                if (!eliminado)
                {
                    return NotFound(new { mensaje = $"Autobús con ID {id} no existe." });
                }
                return Ok(new { mensaje = "Autobús eliminado exitosamente." });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al eliminar el autobús con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al eliminar el autobús." });
            }
        }
    }
}
