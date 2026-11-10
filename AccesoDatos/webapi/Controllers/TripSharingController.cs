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
[Authorize(Roles = RolesUsuario.Operadores)]
public sealed class TripSharingController : ControllerBase
{
    private readonly PrevencionAccidentesBusesContext _context;
    private readonly IDataProtector _protector;

    public TripSharingController(PrevencionAccidentesBusesContext context, IDataProtectionProvider? protection = null)
    {
        _context = context;
        _protector = (protection ?? new EphemeralDataProtectionProvider()).CreateProtector(PublicTripAccess.ProtectorPurpose);
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
    [Authorize(Roles = RolesUsuario.Administradores)]
    public async Task<IActionResult> CreateOrRotate(
        int id,
        [FromBody] CrearAccesoPublicoDto dto,
        CancellationToken cancellationToken)
    {
        return await DatabaseOperation.ExecuteAsync(_context, () => CreateAccessAsync(id, dto, cancellationToken));
    }

    private async Task<IActionResult> CreateAccessAsync(int id, CrearAccesoPublicoDto dto, CancellationToken cancellationToken)
    {
        var userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var parsedUserId)
            ? parsedUserId
            : (int?)null;
        var result = await PublicTripAccess.GetOrCreateAsync(_context, _protector, id, userId, dto.ChatHabilitado, dto.Rotar, cancellationToken);
        return result.Status switch
        {
            PublicTripAccessStatus.TripNotFound => NotFound(new { mensaje = "El viaje no existe." }),
            PublicTripAccessStatus.TripNotActive => BadRequest(new { mensaje = "Solo se puede compartir un viaje que esté en curso." }),
            PublicTripAccessStatus.Unrecoverable => Conflict(new { mensaje = "El enlace anterior no puede recuperarse. Rótalo expresamente para crear uno nuevo sin borrar el historial." }),
            _ => Ok(new AccesoPublicoViajeDto
            {
                Activo = true,
                Token = result.Token,
                FechaExpiracion = result.Access!.FechaExpiracion,
                ChatHabilitado = result.Access.ChatHabilitado
            })
        };
    }

    [HttpDelete("{id:int}/acceso-publico")]
    [Authorize(Roles = RolesUsuario.Administradores)]
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
