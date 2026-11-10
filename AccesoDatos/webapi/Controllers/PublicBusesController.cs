using AccesoDatos.Context;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using webapi.Core;
using webapi.Dtos;

namespace webapi.Controllers;

// Lo que abre el QR pegado en el bus: el enlace del viaje que esa unidad tiene en curso.
[ApiController]
[Route(ApiRoutes.BusesPublicos)]
[AllowAnonymous]
[EnableRateLimiting("PublicReadRateLimit")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicBusesController : ControllerBase
{
    private readonly PrevencionAccidentesBusesContext _context;
    private readonly IDataProtector _protector;

    public PublicBusesController(PrevencionAccidentesBusesContext context, IDataProtectionProvider? protection = null)
    {
        _context = context;
        _protector = (protection ?? new EphemeralDataProtectionProvider()).CreateProtector(PublicTripAccess.ProtectorPurpose);
    }

    [HttpGet("{codigo}")]
    public async Task<IActionResult> Resolve(string codigo, CancellationToken cancellationToken)
    {
        if (!PublicTripToken.IsValid(codigo)) return NotFound(new { mensaje = "Este código no corresponde a ninguna unidad." });
        var bus = await _context.Autobuses.AsNoTracking()
            .Where(item => item.CodigoPublico == codigo)
            .Select(item => new { item.IdAutobus, item.Placa })
            .SingleOrDefaultAsync(cancellationToken);
        if (bus is null) return NotFound(new { mensaje = "Este código no corresponde a ninguna unidad." });

        var tripId = await _context.ViajesDiarios.AsNoTracking()
            .Where(item => item.IdAutobus == bus.IdAutobus && item.EstadoViaje == EstadosViaje.EnCurso)
            .Select(item => (int?)item.IdViaje)
            .SingleOrDefaultAsync(cancellationToken);
        if (tripId is null) return Ok(new BusPublicoDto { Placa = bus.Placa, ViajeActivo = false });

        var result = await DatabaseOperation.ExecuteAsync(_context, () =>
            PublicTripAccess.GetOrCreateAsync(_context, _protector, tripId.Value, actorId: null, chatEnabled: true, rotate: false, cancellationToken));
        // Si las claves de protección se perdieron, el QR crea un enlace nuevo para no dejar al pasajero sin seguimiento.
        if (result.Status == PublicTripAccessStatus.Unrecoverable)
        {
            _context.ChangeTracker.Clear();
            result = await DatabaseOperation.ExecuteAsync(_context, () =>
                PublicTripAccess.GetOrCreateAsync(_context, _protector, tripId.Value, actorId: null, chatEnabled: true, rotate: true, cancellationToken));
        }

        return result.Status == PublicTripAccessStatus.Ok
            ? Ok(new BusPublicoDto { Placa = bus.Placa, ViajeActivo = true, Token = result.Token })
            : Ok(new BusPublicoDto { Placa = bus.Placa, ViajeActivo = false });
    }
}
