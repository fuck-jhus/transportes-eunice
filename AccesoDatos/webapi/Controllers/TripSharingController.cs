using System.Security.Claims;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using webapi.Core;
using webapi.Dtos;

namespace webapi.Controllers;

[ApiController]
[Route(ApiRoutes.Viajes)]
[Authorize(Roles = "Administrador,SuperAdministrador,Supervisor")]
public sealed class TripSharingController : ControllerBase
{
    private readonly PrevencionAccidentesBusesContext _context;
    private readonly IDataProtector _protector;

    public TripSharingController(PrevencionAccidentesBusesContext context, IDataProtectionProvider? protection = null)
    {
        _context = context;
        _protector = (protection ?? new EphemeralDataProtectionProvider()).CreateProtector("Eunice.PublicTripToken.v1");
    }

    [HttpGet("{id:int}/acceso-publico")]
    public async Task<IActionResult> GetStatus(int id, CancellationToken cancellationToken)
    {
        var exists = await _context.ViajesDiarios.AsNoTracking()
            .AnyAsync(item => item.IdViaje == id, cancellationToken);
        if (!exists) return NotFound(new { mensaje = "El viaje no existe." });

        var now = DateTime.UtcNow;
        var access = await _context.ViajesAccesosPublicos.AsNoTracking()
            .Where(item => item.IdViaje == id && item.FechaRevocacion == null && item.FechaExpiracion > now)
            .OrderByDescending(item => item.FechaCreacion)
            .FirstOrDefaultAsync(cancellationToken);

        return Ok(new AccesoPublicoViajeDto
        {
            Activo = access is not null,
            FechaExpiracion = access?.FechaExpiracion,
            ChatHabilitado = access?.ChatHabilitado ?? false
        });
    }

    [HttpPost("{id:int}/acceso-publico")]
    [Authorize(Roles = "Administrador,SuperAdministrador")]
    public async Task<IActionResult> CreateOrRotate(
        int id,
        [FromBody] CrearAccesoPublicoDto dto,
        CancellationToken cancellationToken)
    {
        return await DatabaseOperation.ExecuteAsync(_context, () => CreateAccessAsync(id, dto, cancellationToken));
    }

    private async Task<IActionResult> CreateAccessAsync(int id, CrearAccesoPublicoDto dto, CancellationToken cancellationToken)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);
        await TripLifecycle.LockAsync(_context, $"trip-access:{id}");
        var trip = await _context.ViajesDiarios
            .SingleOrDefaultAsync(item => item.IdViaje == id, cancellationToken);
        if (trip is null) return NotFound(new { mensaje = "El viaje no existe." });
        if (!string.Equals(trip.EstadoViaje, "En Curso", StringComparison.Ordinal))
        {
            return BadRequest(new { mensaje = "Solo se puede compartir un viaje que esté en curso." });
        }

        var now = DateTime.UtcNow;
        var previous = await _context.ViajesAccesosPublicos
            .Where(item => item.IdViaje == id && item.FechaRevocacion == null)
            .ToListAsync(cancellationToken);
        var current = previous.FirstOrDefault(x => x.FechaExpiracion > now);
        if (current != null && !dto.Rotar)
        {
            if (current.TokenProtegido == null) return Conflict(new { mensaje = "El enlace anterior no puede recuperarse. Rótalo expresamente para crear uno nuevo sin borrar el historial." });
            try {
                var savedToken = _protector.Unprotect(current.TokenProtegido);
                return Ok(new AccesoPublicoViajeDto { Activo = true, Token = savedToken, FechaExpiracion = current.FechaExpiracion, ChatHabilitado = current.ChatHabilitado });
            } catch (System.Security.Cryptography.CryptographicException) {
                return Conflict(new { mensaje = "No se pudo recuperar el enlace. Revisa las claves de protección o rótalo expresamente." });
            }
        }
        foreach (var access in previous)
        {
            access.FechaRevocacion = now;
            access.FechaExpiracion = now;
        }

        var token = PublicTripToken.Create();
        var userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var parsedUserId)
            ? parsedUserId
            : (int?)null;
        var entity = new ViajeAccesoPublico
        {
            IdAcceso = Guid.NewGuid(),
            IdViaje = id,
            TokenHash = PublicTripToken.Hash(token),
            TokenProtegido = _protector.Protect(token),
            FechaCreacion = now,
            FechaExpiracion = now.AddHours(72),
            ChatHabilitado = dto.ChatHabilitado,
            IdCreadoPor = userId
        };

        _context.ViajesAccesosPublicos.Add(entity);
        await _context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return Ok(new AccesoPublicoViajeDto
        {
            Activo = true,
            Token = token,
            FechaExpiracion = entity.FechaExpiracion,
            ChatHabilitado = entity.ChatHabilitado
        });
    }

    [HttpDelete("{id:int}/acceso-publico")]
    [Authorize(Roles = "Administrador,SuperAdministrador")]
    public async Task<IActionResult> Revoke(int id, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var affected = await _context.ViajesAccesosPublicos
            .Where(item => item.IdViaje == id && item.FechaRevocacion == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.FechaRevocacion, now)
                .SetProperty(item => item.FechaExpiracion, now), cancellationToken);

        return affected == 0
            ? NotFound(new { mensaje = "El viaje no tiene un acceso público activo." })
            : Ok(new { mensaje = "El enlace público fue revocado." });
    }
}
