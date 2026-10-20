using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using AccesoDatos.Context;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using webapi.Core;
using webapi.Services;

namespace webapi.Controllers;

public sealed class ConfirmDestinationDto
{
    [Range(-90, 90)] public decimal Lat { get; set; }
    [Range(-180, 180)] public decimal Lng { get; set; }
    [Required, StringLength(150, MinimumLength = 1)] public string Nombre { get; set; } = "";
    [Range(0, int.MaxValue)] public int Revision { get; set; }
}

[ApiController, Route("api/viajes/{id:int}/destino"), Authorize(Roles = "Piloto,Administrador,SuperAdministrador")]
public class TripDestinationController(PrevencionAccidentesBusesContext db) : ControllerBase
{
    [HttpPost]
    public Task<IActionResult> Confirm(int id, ConfirmDestinationDto dto) => DatabaseOperation.ExecuteAsync(db, async () => {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return (IActionResult)Unauthorized();
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        await TripLifecycle.LockAsync(db, $"trip:{id}");
        var trip = await db.ViajesDiarios.SingleOrDefaultAsync(x => x.IdViaje == id && x.EstadoViaje == "En Curso"
            && (!User.IsInRole("Piloto") || x.IdUsuario == userId));
        if (trip == null) return NotFound();
        var name = dto.Nombre.Trim();
        var lat = Math.Round(dto.Lat, 8, MidpointRounding.AwayFromZero);
        var lng = Math.Round(dto.Lng, 8, MidpointRounding.AwayFromZero);
        var unchanged = trip.DestinoLatitud == lat && trip.DestinoLongitud == lng && trip.DestinoNombre == name;
        if (!unchanged && trip.RevisionDestino != dto.Revision)
            return Conflict(new { mensaje = "Despacho u otra sesión cambió el viaje. Actualiza la asignación antes de confirmar otro destino." });
        if (!unchanged) {
            trip.DestinoLatitud = lat; trip.DestinoLongitud = lng; trip.DestinoNombre = name;
            trip.DestinoSnapshot = name; trip.NavegacionActualizada = DateTime.UtcNow;
            trip.RevisionDestino++;
            await PushOutbox.DestinationChangedAsync(db, trip, userId);
            await db.SaveChangesAsync();
        }
        await transaction.CommitAsync();
        return Ok(new { trip.IdViaje, trip.Version, trip.RevisionDestino });
    });
}
