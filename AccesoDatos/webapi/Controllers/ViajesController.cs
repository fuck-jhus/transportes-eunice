using System;
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
    [Route(ApiRoutes.Viajes)]
    [Authorize]
    public class ViajesController : ControllerBase
    {
        private readonly IViajeService _viajeService;
        private readonly ILogger<ViajesController> _logger;

        public ViajesController(IViajeService viajeService, ILogger<ViajesController> logger)
        {
            _viajeService = viajeService ?? throw new ArgumentNullException(nameof(viajeService));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpGet]
        [HasPermission(AppPermissions.Viajes.Consultar)]
        public async Task<IActionResult> GetAll([FromQuery] string? estado)
        {
            try
            {
                var userFilter = GetPilotUserFilter();
                if (userFilter == -1) return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });

                var viajes = await _viajeService.GetViajesAsync(estado, userFilter);
                return Ok(viajes);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener la lista de viajes.");
                return StatusCode(500, new { mensaje = "Error al obtener la lista de viajes." });
            }
        }

        [HttpGet("{id:int}")]
        [HasPermission(AppPermissions.Viajes.Consultar)]
        public async Task<IActionResult> GetById(int id)
        {
            try
            {
                var userFilter = GetPilotUserFilter();
                if (userFilter == -1) return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });

                var viaje = await _viajeService.GetViajeByIdAsync(id, userFilter);
                if (viaje == null)
                {
                    return NotFound(new { mensaje = $"Viaje con ID {id} no encontrado." });
                }
                return Ok(viaje);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al consultar el viaje con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al consultar el viaje." });
            }
        }

        [HttpGet("activo-piloto")]
        [HasPermission(AppPermissions.Viajes.Consultar)]
        public async Task<IActionResult> GetActivoPiloto([FromQuery] bool permitirVacio = false)
        {
            try
            {
                var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (string.IsNullOrEmpty(idClaim) || !int.TryParse(idClaim, out int idPiloto))
                {
                    return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });
                }

                var viajeActivo = await _viajeService.GetViajeActivoPorPilotoAsync(idPiloto);
                if (viajeActivo == null)
                {
                    // La web puede pedir una respuesta silenciosa para un estado normal.
                    // El 404 predeterminado conserva compatibilidad con APK ya instaladas.
                    if (permitirVacio)
                    {
                        return NoContent();
                    }

                    return NotFound(new { mensaje = "No tienes ningún viaje activo en curso." });
                }

                return Ok(viajeActivo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al verificar viaje activo del piloto.");
                return StatusCode(500, new { mensaje = "Error al verificar viaje activo del piloto." });
            }
        }

        [HttpPost]
        [HasPermission(AppPermissions.Viajes.Crear)]
        public async Task<IActionResult> Create([FromBody] CrearViajeDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var nuevoViaje = await _viajeService.CrearViajeAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = nuevoViaje.IdViaje }, nuevoViaje);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al crear el viaje.");
                if (DatabaseConflicts.IsConflict(ex)) return Conflict(new { mensaje = DatabaseConflicts.Message });
                return StatusCode(500, new { mensaje = "Error al crear el viaje." });
            }
        }

        [HttpPost("{id:int}/guardar-ruta")]
        [Authorize(Roles = "Piloto,Administrador,SuperAdministrador")]
        public async Task<IActionResult> GuardarRuta(int id, [FromBody] GuardarRutaViajeDto dto)
        {
            if (!ModelState.IsValid)
            {
                return ValidationProblem(ModelState);
            }

            try
            {
                var pilotOwnerFilter = GetPilotUserFilter();
                if (pilotOwnerFilter == -1)
                {
                    return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });
                }

                var viaje = await _viajeService.GuardarRutaEnViajeAsync(id, dto, pilotOwnerFilter);
                if (viaje == null)
                {
                    return NotFound(new { mensaje = "El viaje activo no existe o no pertenece al piloto autenticado." });
                }

                return Ok(viaje);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al guardar la ruta del viaje {Id}.", id);
                return StatusCode(500, new { mensaje = "No se pudo guardar la ruta del viaje." });
            }
        }

        [HttpPost("{id:int}/finalizar")]
        // Se autoriza por rol para que los JWT de pilotos ya emitidos sigan funcionando
        // tras el despliegue. El servicio aplica además el filtro de propiedad del viaje.
        [Authorize(Roles = "Piloto,Administrador,SuperAdministrador")]
        public async Task<IActionResult> Finalizar(int id)
        {
            try
            {
                var pilotOwnerFilter = GetPilotUserFilter();
                if (pilotOwnerFilter == -1)
                {
                    return Unauthorized(new { mensaje = "El token no contiene un ID de usuario válido." });
                }

                var viajeFinalizado = await _viajeService.FinalizarViajeAsync(id, pilotOwnerFilter);
                if (viajeFinalizado == null)
                {
                    return NotFound(new { mensaje = "El viaje no existe o no pertenece al piloto autenticado." });
                }
                return Ok(viajeFinalizado);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al finalizar el viaje con ID {Id}", id);
                if (DatabaseConflicts.IsConflict(ex)) return Conflict(new { mensaje = DatabaseConflicts.Message });
                return StatusCode(500, new { mensaje = "Error al finalizar el viaje." });
            }
        }

        private int? GetPilotUserFilter()
        {
            if (!User.IsInRole("Piloto")) return null;
            return int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ? userId : -1;
        }
    }
}
