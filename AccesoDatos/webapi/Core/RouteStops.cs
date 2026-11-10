using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;

namespace webapi.Core;

public sealed record StopProgress(ParadaRuta Stop, bool Passed);

// Paradas de la ruta de un viaje y cuáles ya pasó la unidad según su GPS.
public static class RouteStops
{
    public const int MaxStops = 25;
    // ~150 m alrededor de la parada: suficiente para tolerar el error del GPS sin confundir paradas vecinas.
    private const decimal Radius = 0.0014m;

    public static async Task<IReadOnlyList<StopProgress>> ForTripAsync(
        PrevencionAccidentesBusesContext db, ViajeDiario trip, bool trackProgress, CancellationToken ct)
    {
        if (trip.IdRuta is null) return [];
        var stops = await db.ParadasRuta.AsNoTracking()
            .Where(x => x.IdRuta == trip.IdRuta)
            .OrderBy(x => x.Orden)
            .Take(MaxStops)
            .ToListAsync(ct);
        if (stops.Count == 0 || !trackProgress) return stops.Select(x => new StopProgress(x, false)).ToList();

        var lastVisited = -1;
        for (var index = stops.Count - 1; index >= 0; index--)
        {
            var stop = stops[index];
            var visited = await db.TelemetriaIots.AsNoTracking().AnyAsync(x => x.IdViaje == trip.IdViaje
                && x.Latitud >= stop.Latitud - Radius && x.Latitud <= stop.Latitud + Radius
                && x.Longitud >= stop.Longitud - Radius && x.Longitud <= stop.Longitud + Radius, ct);
            if (visited) { lastVisited = index; break; }
        }

        // Si la unidad se saltó una parada, las anteriores a la última visitada también cuentan como pasadas.
        return stops.Select((x, index) => new StopProgress(x, index <= lastVisited)).ToList();
    }

    public static double DistanceKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double earth = 6371.0;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
            + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return earth * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}
