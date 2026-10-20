using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System.Security.Claims;
using webapi.Dtos;
using webapi.Services;
using webapi.Core;

namespace webapi.Controllers
{
    [ApiController]
    [Route(ApiRoutes.Usuarios)]
    [Authorize]
    public class UsuariosController : ControllerBase
    {
        private readonly IUserService _userService;
        private readonly ILogger<UsuariosController> _logger;

        public UsuariosController(IUserService userService, ILogger<UsuariosController> logger)
        {
            _userService = userService ?? throw new ArgumentNullException(nameof(userService));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpGet]
        [HasPermission(AppPermissions.Usuarios.Consultar)]
        public async Task<IActionResult> GetAll()
        {
            try
            {
                var usuarios = await _userService.GetUsuariosAsync();
                return Ok(usuarios);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener la lista de usuarios.");
                return StatusCode(500, new { mensaje = "Error al obtener la lista de usuarios." });
            }
        }

        [HttpGet("{id:int}")]
        [HasPermission(AppPermissions.Usuarios.Consultar)]
        public async Task<IActionResult> GetById(int id)
        {
            try
            {
                var usuario = await _userService.GetUsuarioByIdAsync(id);
                if (usuario == null)
                {
                    return NotFound(new { mensaje = $"Usuario con ID {id} no encontrado." });
                }
                return Ok(usuario);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al consultar el usuario con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al consultar el usuario." });
            }
        }

        [HttpPost]
        [HasPermission(AppPermissions.Usuarios.Crear)]
        public async Task<IActionResult> Create([FromBody] CrearUsuarioDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var nuevoUsuario = await _userService.CrearUsuarioAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = nuevoUsuario.IdUsuario }, nuevoUsuario);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al crear el usuario.");
                return StatusCode(500, new { mensaje = "Error al crear el usuario." });
            }
        }

        [HttpPut("{id:int}")]
        [HasPermission(AppPermissions.Usuarios.Editar)]
        public async Task<IActionResult> Edit(int id, [FromBody] EditarUsuarioDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var guardResult = await GuardSensitiveAccountAsync(id, preventSelfAction: false);
                if (guardResult != null) return guardResult;

                var usuarioEditado = await _userService.EditarUsuarioAsync(id, dto);
                if (usuarioEditado == null)
                {
                    return NotFound(new { mensaje = $"Usuario con ID {id} no existe." });
                }
                return Ok(usuarioEditado);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { mensaje = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al actualizar el usuario con ID {Id}", id);
                if (DatabaseConflicts.IsConflict(ex)) return Conflict(new { mensaje = DatabaseConflicts.Message });
                return StatusCode(500, new { mensaje = "Error al actualizar el usuario." });
            }
        }

        [HttpPatch("{id:int}/estado")]
        [HasPermission(AppPermissions.Usuarios.CambiarEstado)]
        public async Task<IActionResult> ChangeStatus(int id, [FromBody] CambiarEstadoDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            try
            {
                var guardResult = await GuardSensitiveAccountAsync(id, preventSelfAction: dto.Estado == "Inactivo");
                if (guardResult != null) return guardResult;

                var resultado = await _userService.CambiarEstadoUsuarioAsync(id, dto.Estado);
                if (!resultado)
                {
                    return NotFound(new { mensaje = $"Usuario con ID {id} no existe." });
                }
                return Ok(new { mensaje = $"Estado del usuario actualizado a '{dto.Estado}' exitosamente." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al actualizar el estado del usuario con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al actualizar el estado del usuario." });
            }
        }

        [HttpDelete("{id:int}")]
        [HasPermission(AppPermissions.Usuarios.Eliminar)]
        public async Task<IActionResult> Delete(int id)
        {
            try
            {
                var guardResult = await GuardSensitiveAccountAsync(id, preventSelfAction: true);
                if (guardResult != null) return guardResult;

                var eliminado = await _userService.EliminarUsuarioAsync(id);
                if (!eliminado)
                {
                    return NotFound(new { mensaje = $"Usuario con ID {id} no encontrado." });
                }
                return Ok(new { mensaje = $"Cuenta de usuario con ID {id} retirada correctamente. Su historial operativo fue preservado." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al eliminar el usuario con ID {Id}", id);
                return StatusCode(500, new { mensaje = "Error al eliminar el usuario." });
            }
        }

        private async Task<IActionResult?> GuardSensitiveAccountAsync(int targetUserId, bool preventSelfAction)
        {
            var currentIdValue = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (preventSelfAction && int.TryParse(currentIdValue, out var currentUserId) && currentUserId == targetUserId)
            {
                return BadRequest(new { mensaje = "No puedes desactivar o retirar tu propia cuenta mientras tienes la sesión abierta." });
            }

            var target = await _userService.GetUsuarioByIdAsync(targetUserId);
            var currentRole = User.FindFirstValue(ClaimTypes.Role);
            if (target != null
                && string.Equals(target.UsuarioLogin, "superadmin", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(currentRole, "SuperAdministrador", StringComparison.Ordinal))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "La cuenta principal solo puede ser administrada por el SuperAdministrador." });
            }

            return null;
        }
    }
}
