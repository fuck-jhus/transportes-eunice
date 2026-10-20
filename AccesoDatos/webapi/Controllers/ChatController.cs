using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using webapi.Core;
using webapi.Services;

namespace webapi.Controllers;

public class ChatMessageItem
{
    public string IdMensaje { get; set; } = string.Empty;
    public int IdEmisor { get; set; }
    public string NombreEmisor { get; set; } = string.Empty;
    public string RolEmisor { get; set; } = string.Empty;
    public int IdPilotoCanal { get; set; }
    public string NombrePilotoCanal { get; set; } = string.Empty;
    public string Contenido { get; set; } = string.Empty;
    public string TipoContenido { get; set; } = "texto";
    public DateTime FechaHora { get; set; }
}

public class EnviarMensajeDto
{
    public Guid? IdCliente { get; set; }
    [Range(0, int.MaxValue)]
    public int IdPilotoCanal { get; set; }

    // Se conserva por compatibilidad; el servidor obtiene el nombre real desde la base de datos.
    [StringLength(100)]
    public string? NombrePilotoCanal { get; set; }

    [Required]
    [StringLength(2000, MinimumLength = 1)]
    public string Contenido { get; set; } = string.Empty;

    // "rapido" se conserva para las versiones moviles ya instaladas.
    [RegularExpression("^(texto|alerta|indicacion|rapido)$")]
    public string? TipoContenido { get; set; } = "texto";
}

public sealed class ReportarContenidoDto
{
    [Required]
    [StringLength(80, MinimumLength = 3)]
    public string Motivo { get; set; } = "Contenido ofensivo o inapropiado";

    [StringLength(500)]
    public string? Detalle { get; set; }
}

[ApiController]
[Route(ApiRoutes.Chat)]
[Authorize(Roles = "Piloto,Administrador,SuperAdministrador,Supervisor")]
public class ChatController : ControllerBase
{
    private const int HistoryLimit = 250;
    private readonly PrevencionAccidentesBusesContext _context;
    private readonly IPushNotificationService _pushNotifications;

    public ChatController(
        PrevencionAccidentesBusesContext context,
        IPushNotificationService? pushNotifications = null)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
        _pushNotifications = pushNotifications ?? NullPushNotificationService.Instance;
    }

    [HttpGet("general")]
    [HttpGet]
    public async Task<IActionResult> GetGeneralMessages(CancellationToken cancellationToken)
    {
        return Ok(await ReadChannelAsync(0, cancellationToken));
    }

    [HttpGet("canal/{idPilotoCanal:int}")]
    public async Task<IActionResult> GetMessagesByChannel(int idPilotoCanal, CancellationToken cancellationToken)
    {
        if (idPilotoCanal < 0)
        {
            return BadRequest(new { mensaje = "El canal solicitado no es válido." });
        }

        if (idPilotoCanal == 0)
        {
            return Ok(await ReadChannelAsync(0, cancellationToken));
        }

        if (!TryGetCurrentUser(out var currentUserId, out var role))
        {
            return Unauthorized(new { mensaje = "Token de autenticación no válido." });
        }

        if ((role == "Piloto" && idPilotoCanal != currentUserId) || (role != "Piloto" && !IsOperatorRole(role)))
        {
            return Forbid();
        }

        return Ok(await ReadChannelAsync(idPilotoCanal, cancellationToken));
    }

    [HttpPost]
    [EnableRateLimiting("ChatRateLimit")]
    public async Task<IActionResult> SendMessage([FromBody] EnviarMensajeDto dto, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(dto.Contenido))
        {
            return BadRequest(new { mensaje = "El contenido del mensaje no puede estar vacío." });
        }

        if (!ContentModeration.IsAllowed(dto.Contenido))
        {
            return BadRequest(new
            {
                mensaje = "El mensaje contiene lenguaje no permitido. Modifícalo antes de enviarlo."
            });
        }

        if (!TryGetCurrentUser(out var currentUserId, out var role))
        {
            return Unauthorized(new { mensaje = "Token de autenticación no válido." });
        }

        if (role == "Supervisor")
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                mensaje = "El perfil Supervisor es de consulta y no puede enviar mensajes."
            });
        }

        var senderName = User.FindFirstValue(ClaimTypes.Name) ?? "Usuario";
        var targetChannel = dto.IdPilotoCanal;
        string targetChannelName;

        if (role == "Piloto" && targetChannel != 0)
        {
            targetChannel = currentUserId;
            targetChannelName = senderName;
        }
        else if (targetChannel == 0)
        {
            targetChannelName = "Canal General de la Flota";
        }
        else
        {
            if (!IsOperatorRole(role))
            {
                return Forbid();
            }

            var pilot = await _context.Usuarios
                .AsNoTracking()
                .Where(user => user.IdUsuario == targetChannel && user.TipoRol == "Piloto" && user.Estado == "Activo")
                .Select(user => user.NombreCompleto)
                .SingleOrDefaultAsync(cancellationToken);

            if (pilot is null)
            {
                return BadRequest(new { mensaje = "El piloto seleccionado no existe o no está activo." });
            }

            targetChannelName = pilot;
        }

        if (dto.IdCliente.HasValue)
        {
            var previous = await _context.MensajesChat.AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdMensaje == dto.IdCliente.Value, cancellationToken);
            if (previous is not null)
                return previous.IdEmisor == currentUserId && previous.IdPilotoCanal == targetChannel && previous.Contenido == dto.Contenido.Trim()
                    ? Ok(ToResponse(previous)) : Conflict(new { mensaje = "El identificador de envío ya fue utilizado." });
        }

        var entity = new MensajeChat
        {
            IdMensaje = dto.IdCliente ?? Guid.NewGuid(),
            IdEmisor = currentUserId,
            NombreEmisor = senderName,
            RolEmisor = role,
            IdPilotoCanal = targetChannel,
            NombrePilotoCanal = targetChannelName,
            Contenido = dto.Contenido.Trim(),
            // La base de datos solo admite los tipos canonicos. Las APK antiguas enviaban
            // "rapido"; se normaliza antes de persistir para no violar CK_mensaje_chat_tipo.
            TipoContenido = dto.TipoContenido == "rapido" ? "indicacion" : dto.TipoContenido ?? "texto",
            FechaHora = DateTime.UtcNow
        };

        _context.MensajesChat.Add(entity);
        try
        {
        var pushData = new Dictionary<string, string?>
        {
            ["eventKey"] = $"chat:{entity.IdMensaje}",
            ["senderId"] = currentUserId.ToString(),
            ["type"] = "chat",
            ["tab"] = "chat",
            ["channelId"] = targetChannel.ToString()
        };
        if (targetChannel == 0)
        {
            await _pushNotifications.SendToRolesAsync(
                ["Piloto", "Administrador", "SuperAdministrador", "Supervisor"],
                "Nuevo mensaje operativo",
                $"{senderName}: {entity.Contenido}",
                pushData,
                currentUserId,
                cancellationToken);
        }
        else if (role == "Piloto")
        {
            await _pushNotifications.SendToRolesAsync(
                ["Administrador", "SuperAdministrador", "Supervisor"],
                $"Mensaje de {senderName}",
                entity.Contenido,
                pushData,
                currentUserId,
                cancellationToken);
        }
        else
        {
            await _pushNotifications.SendToUsersAsync(
                [targetChannel],
                $"Mensaje de {senderName}",
                entity.Contenido,
                pushData,
                cancellationToken);
        }
            await _context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException) when (dto.IdCliente.HasValue)
        {
            _context.Entry(entity).State = EntityState.Detached;
            var previous = await _context.MensajesChat.AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdMensaje == dto.IdCliente.Value, cancellationToken);
            if (previous?.IdEmisor == currentUserId && previous.IdPilotoCanal == targetChannel && previous.Contenido == dto.Contenido.Trim())
                return Ok(ToResponse(previous));
            throw;
        }

        var response = ToResponse(entity);
        var blockedRecipients = await _context.UsuariosChatBloqueados.AsNoTracking()
            .Where(item => item.IdUsuarioBloqueado == currentUserId)
            .Select(item => item.IdUsuario).ToListAsync(cancellationToken);
        await WebSocketConnectionManager.BroadcastChatMessageAsync(response, targetChannel, currentUserId, blockedRecipients);

        return Ok(response);
    }

    [HttpGet("bloqueos")]
    public async Task<IActionResult> GetBlockedUsers(CancellationToken cancellationToken)
    {
        if (!TryGetCurrentUser(out var currentUserId, out _))
        {
            return Unauthorized(new { mensaje = "Token de autenticación no válido." });
        }

        var blockedUsers = await _context.UsuariosChatBloqueados
            .AsNoTracking()
            .Where(item => item.IdUsuario == currentUserId)
            .OrderBy(item => item.IdUsuarioBloqueadoNavigation.NombreCompleto)
            .Select(item => new
            {
                idUsuario = item.IdUsuarioBloqueado,
                nombreCompleto = item.IdUsuarioBloqueadoNavigation.NombreCompleto,
                fechaBloqueo = item.FechaBloqueo
            })
            .ToListAsync(cancellationToken);

        return Ok(blockedUsers);
    }

    [HttpPost("usuarios/{idUsuarioBloqueado:int}/bloqueo")]
    public async Task<IActionResult> SetUserBlocked(
        int idUsuarioBloqueado,
        [FromQuery] bool bloqueado,
        CancellationToken cancellationToken)
    {
        if (!TryGetCurrentUser(out var currentUserId, out _))
        {
            return Unauthorized(new { mensaje = "Token de autenticación no válido." });
        }

        if (idUsuarioBloqueado == currentUserId)
        {
            return BadRequest(new { mensaje = "No puedes bloquear tu propia cuenta." });
        }

        var target = await _context.Usuarios
            .AsNoTracking()
            .Where(item => item.IdUsuario == idUsuarioBloqueado && item.Estado == "Activo")
            .Select(item => new { item.IdUsuario, item.NombreCompleto })
            .SingleOrDefaultAsync(cancellationToken);
        if (target is null)
        {
            return NotFound(new { mensaje = "El usuario ya no está disponible." });
        }

        var existing = await _context.UsuariosChatBloqueados
            .SingleOrDefaultAsync(item => item.IdUsuario == currentUserId
                && item.IdUsuarioBloqueado == idUsuarioBloqueado, cancellationToken);

        if (bloqueado && existing is null)
        {
            _context.UsuariosChatBloqueados.Add(new UsuarioChatBloqueado
            {
                IdUsuario = currentUserId,
                IdUsuarioBloqueado = idUsuarioBloqueado,
                FechaBloqueo = DateTime.UtcNow
            });
        }
        else if (!bloqueado && existing is not null)
        {
            _context.UsuariosChatBloqueados.Remove(existing);
        }

        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new
        {
            mensaje = bloqueado
                ? $"Ya no verás mensajes de {target.NombreCompleto}."
                : $"Volverás a ver mensajes de {target.NombreCompleto}.",
            bloqueado
        });
    }

    [HttpPost("{idMensaje:guid}/reportes")]
    [EnableRateLimiting("ChatRateLimit")]
    public async Task<IActionResult> ReportMessage(
        Guid idMensaje,
        [FromBody] ReportarContenidoDto dto,
        CancellationToken cancellationToken)
    {
        if (!TryGetCurrentUser(out var currentUserId, out _))
        {
            return Unauthorized(new { mensaje = "Token de autenticación no válido." });
        }

        var message = await _context.MensajesChat
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdMensaje == idMensaje && !item.Eliminado, cancellationToken);
        if (message is null)
        {
            return NotFound(new { mensaje = "El mensaje ya no está disponible." });
        }

        if (message.IdEmisor == currentUserId)
        {
            return BadRequest(new { mensaje = "No puedes denunciar tu propio mensaje." });
        }

        var alreadyReported = await _context.ReportesContenido.AsNoTracking()
            .AnyAsync(item => item.IdReportante == currentUserId
                && item.TipoContenido == "ChatOperativo"
                && item.IdMensaje == idMensaje, cancellationToken);
        if (alreadyReported)
        {
            return Ok(new { mensaje = "Este mensaje ya fue enviado a revisión." });
        }

        _context.ReportesContenido.Add(new ReporteContenido
        {
            IdReporte = Guid.NewGuid(),
            TipoContenido = "ChatOperativo",
            IdMensaje = idMensaje,
            IdReportante = currentUserId,
            IdUsuarioReportado = message.IdEmisor,
            AliasReportado = message.NombreEmisor,
            Motivo = dto.Motivo.Trim(),
            Detalle = string.IsNullOrWhiteSpace(dto.Detalle) ? null : dto.Detalle.Trim(),
            Estado = "Pendiente",
            FechaReporte = DateTime.UtcNow
        });
        await _pushNotifications.SendToRolesAsync(
            ["Administrador", "SuperAdministrador"],
            "Contenido denunciado",
            "Hay un mensaje del chat operativo pendiente de revisión.",
            new Dictionary<string, string?> { ["eventKey"] = $"chat-report:{idMensaje}:{currentUserId}", ["type"] = "content_report", ["tab"] = "chat", ["channelId"] = message.IdPilotoCanal.ToString(), ["messageId"] = idMensaje.ToString() },
            currentUserId,
            cancellationToken);

        await _context.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { mensaje = "Denuncia enviada para revisión." });
    }

    [HttpDelete("{idMensaje:guid}")]
    public async Task<IActionResult> DeleteMessage(Guid idMensaje, CancellationToken cancellationToken)
    {
        if (!TryGetAdministrator(out var currentUserId))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "Solo los administradores pueden eliminar mensajes del chat." });
        }

        var message = await _context.MensajesChat
            .SingleOrDefaultAsync(item => item.IdMensaje == idMensaje && !item.Eliminado, cancellationToken);
        if (message is null)
        {
            return NotFound(new { mensaje = "Mensaje no encontrado o ya eliminado." });
        }

        message.Eliminado = true;
        message.FechaEliminacion = DateTime.UtcNow;
        message.IdEliminadoPor = currentUserId;
        await _context.SaveChangesAsync(cancellationToken);

        await WebSocketConnectionManager.BroadcastChatDeleteAsync(idMensaje.ToString(), message.IdPilotoCanal);
        return Ok(new { mensaje = "Mensaje eliminado exitosamente.", idMensaje });
    }

    [HttpDelete("canal/{idPilotoCanal:int}")]
    public async Task<IActionResult> ClearChannel(int idPilotoCanal, CancellationToken cancellationToken)
    {
        if (idPilotoCanal < 0)
        {
            return BadRequest(new { mensaje = "El canal solicitado no es válido." });
        }

        if (!TryGetAdministrator(out var currentUserId))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "Solo los administradores pueden vaciar el chat." });
        }

        await SoftDeleteAsync(item => item.IdPilotoCanal == idPilotoCanal, currentUserId, cancellationToken);
        await WebSocketConnectionManager.BroadcastChatClearAsync(idPilotoCanal);
        return Ok(new { mensaje = "Canal vaciado exitosamente." });
    }

    [HttpDelete("limpiar-todo")]
    public async Task<IActionResult> ClearAllChats(CancellationToken cancellationToken)
    {
        if (!TryGetAdministrator(out var currentUserId))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { mensaje = "Solo los administradores pueden vaciar todos los chats." });
        }

        await SoftDeleteAsync(_ => true, currentUserId, cancellationToken);
        await WebSocketConnectionManager.BroadcastChatClearAsync(-1);
        return Ok(new { mensaje = "Todos los chats han sido vaciados exitosamente." });
    }

    private async Task SoftDeleteAsync(
        System.Linq.Expressions.Expression<Func<MensajeChat, bool>> predicate,
        int deletedBy,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await _context.MensajesChat
            .Where(predicate)
            .Where(item => !item.Eliminado)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Eliminado, true)
                .SetProperty(item => item.FechaEliminacion, now)
                .SetProperty(item => item.IdEliminadoPor, deletedBy), cancellationToken);
    }

    private async Task<List<ChatMessageItem>> ReadChannelAsync(int channelId, CancellationToken cancellationToken)
    {
        var blockedIds = new List<int>();
        if (TryGetCurrentUser(out var currentUserId, out _))
        {
            blockedIds = await _context.UsuariosChatBloqueados
                .AsNoTracking()
                .Where(item => item.IdUsuario == currentUserId)
                .Select(item => item.IdUsuarioBloqueado)
                .ToListAsync(cancellationToken);
        }

        var newestFirst = await _context.MensajesChat
            .AsNoTracking()
            .Where(item => item.IdPilotoCanal == channelId
                && !item.Eliminado
                && !blockedIds.Contains(item.IdEmisor))
            .OrderByDescending(item => item.FechaHora)
            .Take(HistoryLimit)
            .Select(item => new ChatMessageItem
            {
                IdMensaje = item.IdMensaje.ToString(),
                IdEmisor = item.IdEmisor,
                NombreEmisor = item.NombreEmisor,
                RolEmisor = item.RolEmisor,
                IdPilotoCanal = item.IdPilotoCanal,
                NombrePilotoCanal = item.NombrePilotoCanal,
                Contenido = item.Contenido,
                TipoContenido = item.TipoContenido,
                FechaHora = item.FechaHora
            })
            .ToListAsync(cancellationToken);

        newestFirst.Reverse();
        return newestFirst;
    }

    private bool TryGetCurrentUser(out int userId, out string role)
    {
        role = User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;
        return int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
    }

    private bool TryGetAdministrator(out int userId)
    {
        var validUser = TryGetCurrentUser(out userId, out var role);
        return validUser && role is "Administrador" or "SuperAdministrador";
    }

    private static bool IsOperatorRole(string? role) =>
        role is "Administrador" or "SuperAdministrador" or "Supervisor";

    private static ChatMessageItem ToResponse(MensajeChat item) => new()
    {
        IdMensaje = item.IdMensaje.ToString(),
        IdEmisor = item.IdEmisor,
        NombreEmisor = item.NombreEmisor,
        RolEmisor = item.RolEmisor,
        IdPilotoCanal = item.IdPilotoCanal,
        NombrePilotoCanal = item.NombrePilotoCanal,
        Contenido = item.Contenido,
        TipoContenido = item.TipoContenido,
        FechaHora = item.FechaHora
    };
}
