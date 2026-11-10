using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using webapi.Core;
using webapi.Dtos;

namespace webapi.Controllers;

[ApiController]
[Route(ApiRoutes.Rutas)]
[Authorize(Roles = RolesUsuario.Todos)]
public sealed class RouteStopsController : ControllerBase
{
    private readonly PrevencionAccidentesBusesContext _context;

    public RouteStopsController(PrevencionAccidentesBusesContext context) => _context = context;

    [HttpGet("{id:int}/paradas")]
    public async Task<IActionResult> Get(int id, CancellationToken cancellationToken)
    {
        if (!await _context.Ruta.AnyAsync(x => x.IdRuta == id, cancellationToken))
            return NotFound(new { mensaje = "La ruta no existe." });
        return Ok(await ReadAsync(id, cancellationToken));
    }

    // Reemplaza la lista completa: el orden de la lista es el orden del recorrido.
    [HttpPut("{id:int}/paradas")]
    [Authorize(Roles = RolesUsuario.Administradores)]
    public async Task<IActionResult> Replace(int id, [FromBody] List<GuardarParadaDto> stops, CancellationToken cancellationToken)
    {
        if (stops.Count > RouteStops.MaxStops)
            return BadRequest(new { mensaje = $"Una ruta puede tener como máximo {RouteStops.MaxStops} paradas." });
        var clean = stops.Select(x => new { Nombre = (x.Nombre ?? string.Empty).Trim(), x.Latitud, x.Longitud }).ToList();
        if (clean.Any(x => x.Nombre.Length is < 2 or > 100))
            return BadRequest(new { mensaje = "Cada parada necesita un nombre de 2 a 100 caracteres." });
        if (clean.Any(x => x.Latitud is < -90 or > 90 || x.Longitud is < -180 or > 180))
            return BadRequest(new { mensaje = "Hay una parada con coordenadas inválidas." });

        return await DatabaseOperation.ExecuteAsync(_context, async () =>
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            if (!await _context.Ruta.AnyAsync(x => x.IdRuta == id, cancellationToken))
                return (IActionResult)NotFound(new { mensaje = "La ruta no existe." });
            var previous = await _context.ParadasRuta.Where(x => x.IdRuta == id).ToListAsync(cancellationToken);
            _context.ParadasRuta.RemoveRange(previous);
            await _context.SaveChangesAsync(cancellationToken);
            _context.ParadasRuta.AddRange(clean.Select((x, index) => new ParadaRuta
            {
                IdRuta = id,
                Orden = index + 1,
                Nombre = x.Nombre,
                Latitud = Math.Round(x.Latitud, 8),
                Longitud = Math.Round(x.Longitud, 8)
            }));
            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Ok(await ReadAsync(id, cancellationToken));
        });
    }

    private Task<List<ParadaDto>> ReadAsync(int routeId, CancellationToken cancellationToken) =>
        _context.ParadasRuta.AsNoTracking()
            .Where(x => x.IdRuta == routeId)
            .OrderBy(x => x.Orden)
            .Select(x => new ParadaDto { IdParada = x.IdParada, Orden = x.Orden, Nombre = x.Nombre, Latitud = x.Latitud, Longitud = x.Longitud })
            .ToListAsync(cancellationToken);
}
