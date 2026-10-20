using AccesoDatos.Models;

namespace webapi.Core;

public sealed class TrackingSourceConflictException() : Exception("Otro dispositivo controla el rastreo. Puedes tomar el control expresamente desde el panel de telemetría.");

public static class TrackingSourcePolicy
{
    public static bool MayPublish(ViajeDiario trip, string? source) => trip.IdFuenteRastreo == source;
    public static void Validate(ViajeDiario trip, string? source, DateTime observedAt, DateTime now)
    {
        // Older archives remain bound to their original journey. They never drive live fan-out.
        if (trip.EstadoViaje == "En Curso" && observedAt >= now.AddSeconds(-30) && !MayPublish(trip, source))
            throw new TrackingSourceConflictException();
    }
}
