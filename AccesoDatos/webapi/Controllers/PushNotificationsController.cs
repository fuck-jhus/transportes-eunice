using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using webapi.Core;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Controllers;

[ApiController]
[Route(ApiRoutes.Notificaciones)]
[Authorize]
public sealed class PushNotificationsController : ControllerBase
{
    private readonly IPushNotificationService _pushNotifications;

    public PushNotificationsController(IPushNotificationService pushNotifications)
    {
        _pushNotifications = pushNotifications;
    }

    [HttpPost("dispositivos")]
    public async Task<IActionResult> RegisterDevice(
        [FromBody] RegistrarDispositivoPushDto dto,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        try
        {
            await _pushNotifications.RegisterDeviceAsync(
                userId,
                dto.ExpoPushToken,
                dto.Plataforma,
                dto.DeviceId,
                cancellationToken);
            return Ok(new { mensaje = "Dispositivo habilitado para notificaciones." });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { mensaje = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { mensaje = exception.Message });
        }
    }

    [HttpDelete("dispositivos")]
    public async Task<IActionResult> UnregisterDevice(
        [FromBody] EliminarDispositivoPushDto dto,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        await _pushNotifications.UnregisterDeviceAsync(userId, dto.ExpoPushToken, cancellationToken);
        return Ok(new { mensaje = "Notificaciones deshabilitadas en este dispositivo." });
    }

    private bool TryGetUserId(out int userId) =>
        int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
}
