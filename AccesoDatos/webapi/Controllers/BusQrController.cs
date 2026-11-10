using AccesoDatos.Context;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using webapi.Core;
using webapi.Dtos;

namespace webapi.Controllers;

// Código fijo del QR que se pega dentro de cada bus.
[ApiController]
[Route(ApiRoutes.Autobuses)]
[Authorize(Roles = RolesUsuario.Administradores)]
public sealed class BusQrController : ControllerBase
{
    private readonly PrevencionAccidentesBusesContext _context;

    public BusQrController(PrevencionAccidentesBusesContext context) => _context = context;

    [HttpGet("{id:int}/qr")]
    public Task<IActionResult> Get(int id, CancellationToken cancellationToken) => IssueAsync(id, rotate: false, cancellationToken);

    // Rotar invalida el QR impreso anterior (por ejemplo, si una calcomanía se perdió o se copió).
    [HttpPost("{id:int}/qr/rotar")]
    public Task<IActionResult> Rotate(int id, CancellationToken cancellationToken) => IssueAsync(id, rotate: true, cancellationToken);

    private async Task<IActionResult> IssueAsync(int id, bool rotate, CancellationToken cancellationToken)
    {
        var bus = await _context.Autobuses.SingleOrDefaultAsync(item => item.IdAutobus == id, cancellationToken);
        if (bus is null) return NotFound(new { mensaje = "El autobús no existe." });
        if (rotate || string.IsNullOrEmpty(bus.CodigoPublico))
        {
            bus.CodigoPublico = PublicTripToken.Create();
            await _context.SaveChangesAsync(cancellationToken);
        }

        return Ok(new CodigoQrAutobusDto { IdAutobus = bus.IdAutobus, Placa = bus.Placa, Codigo = bus.CodigoPublico! });
    }
}
