using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using webapi.Services;

namespace webapi.Core;

// Used inside the caller's transaction. All close paths have the same durable effects.
public static class TripLifecycle
{
    public static void Snapshot(ViajeDiario trip, Usuario? pilot, Autobus? bus, Rutum? route)
    {
        trip.NombrePilotoSnapshot ??= pilot?.NombreCompleto;
        trip.PlacaSnapshot ??= bus?.Placa;
        trip.NombreRutaSnapshot ??= route?.NombreRuta;
        trip.OrigenSnapshot ??= route?.Origen;
        trip.DestinoSnapshot ??= trip.DestinoNombre ?? route?.Destino;
        trip.DestinoLatitud ??= route?.DestinoLatitud;
        trip.DestinoLongitud ??= route?.DestinoLongitud;
    }

    public static async Task<bool> FinishAsync(PrevencionAccidentesBusesContext db, ViajeDiario trip, string reason, int? actorId = null)
    {
        if (trip.EstadoViaje == "Finalizado") return false;
        Snapshot(trip, trip.IdUsuarioNavigation, trip.IdAutobusNavigation, trip.IdRutaNavigation);
        trip.EstadoViaje = "Finalizado";
        trip.FechaFin ??= DateTime.UtcNow;
        trip.MotivoFinalizacion = reason;
        trip.ModoPrivacidad = true;
        trip.IdFuenteRastreo = null;
        trip.FuenteRastreoExpira = null;
        var accesses = await db.ViajesAccesosPublicos.Where(x => x.IdViaje == trip.IdViaje && x.FechaRevocacion == null).ToListAsync();
        foreach (var access in accesses)
        {
            var expires = trip.FechaFin.Value.AddMinutes(30);
            if (access.FechaExpiracion > expires) access.FechaExpiracion = expires;
            access.ChatHabilitado = false;
        }
        await PushOutbox.AddAsync(db, $"trip-finished:{trip.IdViaje}", "Viaje finalizado",
            $"{trip.PlacaSnapshot ?? "Unidad"}: {reason}. Abre Eunice para consultar el viaje.",
            PushOutbox.TripData("trip_finished", trip.IdViaje), [trip.IdUsuario], PushOutbox.Operators, actorId);
        return true;
    }

    public static async Task LockAsync(PrevencionAccidentesBusesContext db, string resource)
    {
        if (!db.Database.IsSqlServer()) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource={resource}, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; IF @r < 0 THROW 51010, 'La operación está ocupada. Vuelve a intentar.', 1;");
    }
}
