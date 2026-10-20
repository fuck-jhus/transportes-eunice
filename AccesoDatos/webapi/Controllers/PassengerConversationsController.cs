using System.Security.Claims;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using webapi.Core;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Controllers;

[ApiController]
[Route(ApiRoutes.ConversacionesPasajeros)]
[Authorize(Roles = "Piloto,Administrador,SuperAdministrador,Supervisor")]
public sealed class PassengerConversationsController : ControllerBase
{
    private readonly PrevencionAccidentesBusesContext _context;
    private readonly IPushNotificationService _pushNotifications;

    public PassengerConversationsController(
        PrevencionAccidentesBusesContext context,
        IPushNotificationService? pushNotifications = null)
    {
        _context = context;
        _pushNotifications = pushNotifications ?? NullPushNotificationService.Instance;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int? idViaje, CancellationToken cancellationToken)
    {
        if (!TryGetUser(out var userId, out var role)) return Unauthorized();
        var now = DateTime.UtcNow;
        // Internal history survives expiration/revocation of the public credential.
        var query = _context.ConversacionesPasajeros.AsNoTracking().AsQueryable();

        if (role == "Piloto")
        {
            query = query.Where(item => item.IdAccesoNavigation.IdViajeNavigation.IdUsuario == userId);
        }
        else if (!IsOperator(role))
        {
            return Forbid();
        }

        if (idViaje.HasValue)
        {
            query = query.Where(item => item.IdAccesoNavigation.IdViaje == idViaje.Value);
        }

        var conversations = await query
            .OrderByDescending(item => item.FechaUltimaActividad)
            .Take(100)
            .Select(item => new ConversacionPasajeroDto
            {
                IdConversacion = item.IdConversacion,
                IdViaje = item.IdAccesoNavigation.IdViaje,
                AliasPasajero = item.AliasPasajero,
                NombreRuta = item.IdAccesoNavigation.IdViajeNavigation.IdRutaNavigation != null
                    ? item.IdAccesoNavigation.IdViajeNavigation.IdRutaNavigation.NombreRuta
                    : item.IdAccesoNavigation.IdViajeNavigation.DestinoNombre ?? "Recorrido en curso",
                Unidad = item.IdAccesoNavigation.IdViajeNavigation.IdAutobusNavigation.Placa,
                FechaUltimaActividad = item.FechaUltimaActividad,
                Bloqueada = item.Bloqueada,
                NoLeidos = item.Mensajes.Count(message => message.TipoEmisor == "Pasajero" && message.FechaLectura == null),
                UltimoMensaje = item.Mensajes
                    .OrderByDescending(message => message.FechaHora)
                    .Select(message => message.Contenido)
                    .FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        return Ok(conversations);
    }

    [HttpGet("{id:guid}/mensajes")]
    public async Task<IActionResult> GetMessages(Guid id, CancellationToken cancellationToken, [FromQuery] Guid? antes = null)
    {
        var conversation = await GetAuthorizedConversationAsync(id, cancellationToken);
        if (conversation is null) return NotFound(new { mensaje = "La conversación no existe o no está disponible." });

        var query = _context.MensajesPasajeros.AsNoTracking().Where(item => item.IdConversacion == id);
        if (antes.HasValue) {
            var cursor = await query.SingleOrDefaultAsync(x => x.IdMensaje == antes.Value, cancellationToken);
            if (cursor == null) return BadRequest(new { mensaje = "El cursor no pertenece a la conversación." });
            query = query.Where(x => x.FechaHora < cursor.FechaHora || (x.FechaHora == cursor.FechaHora && x.IdMensaje.CompareTo(cursor.IdMensaje) < 0));
        }
        var messages = await query
            .OrderByDescending(item => item.FechaHora)
            .ThenByDescending(item => item.IdMensaje)
            .Take(200)
            .Select(item => new MensajePasajeroDto
            {
                IdMensaje = item.IdMensaje,
                IdConversacion = item.IdConversacion,
                TipoEmisor = item.TipoEmisor,
                NombreEmisor = item.NombreEmisor,
                Contenido = item.Contenido,
                IdCliente = item.IdCliente,
                IdUsuarioEmisor = item.IdUsuarioEmisor,
                FechaHora = item.FechaHora,
                FechaLectura = item.FechaLectura
            })
            .ToListAsync(cancellationToken);
        messages.Reverse();
        return Ok(messages);
    }

    [HttpPost("{id:guid}/leido")]
    public async Task<IActionResult> Acknowledge(Guid id, PassengerReadReceiptDto dto, CancellationToken cancellationToken)
    {
        if (User.IsInRole("Supervisor")) return Forbid();
        var conversation = await GetAuthorizedConversationAsync(id, cancellationToken);
        if (conversation == null) return NotFound();
        var messages = await _context.MensajesPasajeros.Where(x => x.IdConversacion == id && dto.IdsMensaje.Contains(x.IdMensaje)
            && x.TipoEmisor == "Pasajero" && x.FechaLectura == null).ToListAsync(cancellationToken);
        var now = DateTime.UtcNow;
        foreach (var message in messages) { message.FechaEntrega ??= now; message.FechaLectura = now; }
        conversation.FechaLecturaOperador = now;
        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new { confirmados = messages.Count, alcance = "equipo" });
    }

    [HttpPost("{id:guid}/mensajes")]
    [EnableRateLimiting("ChatRateLimit")]
    public async Task<IActionResult> Reply(
        Guid id,
        [FromBody] EnviarRespuestaPasajeroDto dto,
        CancellationToken cancellationToken)
    {
        if (!TryGetUser(out var userId, out var role)) return Unauthorized();
        if (role == "Supervisor")
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                mensaje = "El perfil Supervisor es de consulta y no puede responder conversaciones."
            });
        }
        var conversation = await GetAuthorizedConversationAsync(id, cancellationToken);
        if (conversation is null) return NotFound(new { mensaje = "La conversación no existe o no está disponible." });
        if (conversation.Bloqueada) return BadRequest(new { mensaje = "La conversación está bloqueada." });
        if (conversation.IdAccesoNavigation.FechaRevocacion != null || conversation.IdAccesoNavigation.FechaExpiracion <= DateTime.UtcNow)
            return BadRequest(new { mensaje = "El enlace público expiró. El historial es de consulta y no admite respuestas nuevas." });
        if (conversation.IdAccesoNavigation.IdViajeNavigation.EstadoViaje != "En Curso")
        {
            return BadRequest(new { mensaje = "El viaje finalizó y la conversación está cerrada." });
        }

        if (role == "Piloto" && !dto.RespuestaRapida)
        {
            var latestSpeed = await _context.TelemetriaIots.AsNoTracking()
                .Where(item => item.IdViaje == conversation.IdAccesoNavigation.IdViaje)
                .OrderByDescending(item => item.FechaHoraDispositivo)
                .Select(item => new { item.VelocidadKmh, item.FechaHoraDispositivo })
                .FirstOrDefaultAsync(cancellationToken);
            if (latestSpeed is not null
                && DateTime.UtcNow - EnsureUtc(latestSpeed.FechaHoraDispositivo) < TimeSpan.FromMinutes(2)
                && latestSpeed.VelocidadKmh > 5)
            {
                return StatusCode(StatusCodes.Status409Conflict, new
                {
                    mensaje = "Por seguridad, mientras la unidad está en movimiento solo puedes usar respuestas rápidas."
                });
            }
        }

        var content = PublicTripToken.NormalizeMessage(dto.Contenido);
        if (string.IsNullOrWhiteSpace(content)) return BadRequest(new { mensaje = "El mensaje no puede estar vacío." });
        if (!ContentModeration.IsAllowed(content))
        {
            return BadRequest(new
            {
                mensaje = "El mensaje contiene lenguaje no permitido. Modifícalo antes de enviarlo."
            });
        }

        if (dto.IdCliente.HasValue)
        {
            var previous = await _context.MensajesPasajeros.AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdMensaje == dto.IdCliente.Value, cancellationToken);
            if (previous is not null)
                return previous.IdUsuarioEmisor == userId && previous.IdConversacion == id && previous.Contenido == content
                    ? Ok(ToMessageDto(previous)) : Conflict(new { mensaje = "El identificador de envío ya fue utilizado." });
        }
        var senderName = User.FindFirstValue(ClaimTypes.Name) ?? (role == "Piloto" ? "Conductor" : "Centro de control");
        var message = new MensajePasajero
        {
            IdMensaje = dto.IdCliente ?? Guid.NewGuid(),
            IdConversacion = id,
            TipoEmisor = role == "Piloto" ? "Piloto" : "Operador",
            IdUsuarioEmisor = userId,
            NombreEmisor = senderName,
            Contenido = content,
            FechaHora = DateTime.UtcNow,
            FechaEntrega = DateTime.UtcNow
        };
        conversation.FechaUltimaActividad = message.FechaHora;
        await GuestWebPushService.QueueReplyAsync(_context, conversation.IdConversacion, message.IdMensaje, cancellationToken);
        _context.MensajesPasajeros.Add(message);
        try { await _context.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException) when (dto.IdCliente.HasValue)
        {
            _context.Entry(message).State = EntityState.Detached;
            var previous = await _context.MensajesPasajeros.AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdMensaje == dto.IdCliente.Value, cancellationToken);
            if (previous?.IdUsuarioEmisor == userId && previous.IdConversacion == id && previous.Contenido == content)
                return Ok(ToMessageDto(previous));
            throw;
        }

        var response = ToMessageDto(message);
        await WebSocketConnectionManager.BroadcastPassengerMessageAsync(
            response,
            conversation.IdAccesoNavigation.IdViajeNavigation.IdUsuario);
        return Ok(response);
    }

    [HttpPost("{id:guid}/bloqueo")]
    [Authorize(Roles = "Piloto,Administrador,SuperAdministrador")]
    public async Task<IActionResult> SetBlocked(Guid id, [FromQuery] bool bloqueada, CancellationToken cancellationToken)
    {
        var conversation = await GetAuthorizedConversationAsync(id, cancellationToken);
        if (conversation is null) return NotFound(new { mensaje = "La conversación no existe o ya no está disponible." });
        conversation.Bloqueada = bloqueada;
        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new { mensaje = bloqueada ? "Conversación bloqueada." : "Conversación habilitada.", bloqueada });
    }

    [HttpPost("{id:guid}/mensajes/{idMensaje:guid}/reportes")]
    [Authorize(Roles = "Piloto,Administrador,SuperAdministrador")]
    [EnableRateLimiting("ChatRateLimit")]
    public async Task<IActionResult> ReportPassengerMessage(
        Guid id,
        Guid idMensaje,
        [FromBody] ReportarContenidoDto dto,
        CancellationToken cancellationToken)
    {
        if (!TryGetUser(out var currentUserId, out _)) return Unauthorized();
        var conversation = await GetAuthorizedConversationAsync(id, cancellationToken);
        if (conversation is null)
        {
            return NotFound(new { mensaje = "La conversación no existe o ya no está disponible." });
        }

        var message = await _context.MensajesPasajeros
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdConversacion == id
                && item.IdMensaje == idMensaje
                && item.TipoEmisor == "Pasajero", cancellationToken);
        if (message is null)
        {
            return NotFound(new { mensaje = "El mensaje del pasajero ya no está disponible." });
        }

        var alreadyReported = await _context.ReportesContenido.AsNoTracking()
            .AnyAsync(item => item.IdReportante == currentUserId
                && item.TipoContenido == "ChatPasajero"
                && item.IdMensaje == idMensaje, cancellationToken);
        if (alreadyReported)
        {
            return Ok(new { mensaje = "Este mensaje ya fue enviado a revisión." });
        }

        _context.ReportesContenido.Add(new ReporteContenido
        {
            IdReporte = Guid.NewGuid(),
            TipoContenido = "ChatPasajero",
            IdMensaje = idMensaje,
            IdConversacion = id,
            IdReportante = currentUserId,
            AliasReportado = message.NombreEmisor,
            Motivo = dto.Motivo.Trim(),
            Detalle = string.IsNullOrWhiteSpace(dto.Detalle) ? null : dto.Detalle.Trim(),
            Estado = "Pendiente",
            FechaReporte = DateTime.UtcNow
        });
        await _pushNotifications.SendToRolesAsync(
            ["Administrador", "SuperAdministrador"],
            "Contenido de pasajero denunciado",
            "Hay un mensaje de pasajero pendiente de revisión.",
            new Dictionary<string, string?>
            {
                ["eventKey"] = $"passenger-report:{idMensaje}:{currentUserId}",
                ["type"] = "content_report",
                ["tab"] = "chat",
                ["conversationId"] = id.ToString()
            },
            currentUserId,
            cancellationToken);

        await _context.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { mensaje = "Denuncia enviada para revisión." });
    }

    private async Task<ConversacionPasajero?> GetAuthorizedConversationAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!TryGetUser(out var userId, out var role)) return null;
        var conversation = await _context.ConversacionesPasajeros
            .Include(item => item.IdAccesoNavigation)
                .ThenInclude(item => item.IdViajeNavigation)
            .SingleOrDefaultAsync(item => item.IdConversacion == id, cancellationToken);
        if (conversation is null) return null;
        return role == "Piloto" && conversation.IdAccesoNavigation.IdViajeNavigation.IdUsuario != userId
            ? null
            : IsOperator(role) || role == "Piloto"
                ? conversation
                : null;
    }

    private bool TryGetUser(out int userId, out string role)
    {
        role = User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;
        return int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
    }

    private static bool IsOperator(string role) => role is "Administrador" or "SuperAdministrador" or "Supervisor";

    private static DateTime EnsureUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static MensajePasajeroDto ToMessageDto(MensajePasajero item) => new()
    {
        IdUsuarioEmisor = item.IdUsuarioEmisor,
        IdMensaje = item.IdMensaje,
        IdConversacion = item.IdConversacion,
        TipoEmisor = item.TipoEmisor,
        NombreEmisor = item.NombreEmisor,
        Contenido = item.Contenido,
        IdCliente = item.IdCliente,
        FechaHora = item.FechaHora,
        FechaLectura = item.FechaLectura
    };
}
