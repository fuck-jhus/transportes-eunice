using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using AccesoDatos.Context;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using webapi.Core;

namespace webapi.Controllers;

public record TrackingSourceRequest([Required, StringLength(100, MinimumLength = 1)] string IdFuente, bool TomarControl = false);

[ApiController, Authorize(Roles = "Piloto"), Route("api/viajes/{id:int}/fuente-rastreo")]
public class TrackingSourceController(PrevencionAccidentesBusesContext db) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Acquire(int id, TrackingSourceRequest dto)
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var pilot)) return Unauthorized();
        return await DatabaseOperation.ExecuteAsync(db, async () => {
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            await TripLifecycle.LockAsync(db, $"trip:{id}");
            var trip = await db.ViajesDiarios.SingleOrDefaultAsync(x => x.IdViaje == id && x.IdUsuario == pilot && x.EstadoViaje == "En Curso");
            if (trip == null) return (IActionResult)NotFound();
            if (trip.IdFuenteRastreo != null && !TrackingSourcePolicy.MayPublish(trip, dto.IdFuente) && !dto.TomarControl)
                return Conflict(new { mensaje = "Otro dispositivo tiene el control del GPS. Puedes consultar sin interrumpirlo o tomar el control expresamente.", codigo = "OTRA_FUENTE", expira = trip.FuenteRastreoExpira });
            trip.IdFuenteRastreo = dto.IdFuente;
            trip.FuenteRastreoExpira = DateTime.UtcNow.AddMinutes(2);
            await db.SaveChangesAsync(); await tx.CommitAsync();
            return Ok(new { idFuente = trip.IdFuenteRastreo, expira = trip.FuenteRastreoExpira });
        });
    }
}
