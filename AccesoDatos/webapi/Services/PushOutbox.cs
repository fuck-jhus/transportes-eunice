using System.Text.Json;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;

namespace webapi.Services;

// Adds intent to the caller's unit of work. The caller commits both business data
// and this intent; only the background dispatcher contacts notification providers.
public static class PushOutbox
{
    public static readonly string[] Operators = ["Administrador", "SuperAdministrador", "Supervisor"];

    public static async Task AddAsync(PrevencionAccidentesBusesContext db, string eventKey,
        string title, string body, IReadOnlyDictionary<string, string?> data,
        IEnumerable<int>? users = null, IEnumerable<string>? roles = null,
        int? excludeUserId = null, CancellationToken ct = default)
    {
        if (eventKey.StartsWith("evaluation:", StringComparison.Ordinal))
        {
            if (db.PushNotificationMarkers.Local.Any(x => x.EventKey == eventKey)
                || await db.PushNotificationMarkers.AnyAsync(x => x.EventKey == eventKey, ct)) return;
            db.PushNotificationMarkers.Add(new PushNotificationMarker { EventKey = eventKey, CreatedAt = DateTime.UtcNow });
        }
        if (db.PushOutboxMessages.Local.Any(x => x.EventKey == eventKey)
            || await db.PushOutboxMessages.AnyAsync(x => x.EventKey == eventKey, ct)) return;
        var now = DateTime.UtcNow;
        db.PushOutboxMessages.Add(new PushOutboxMessage
        {
            EventKey = eventKey, Title = Limit(title, 100), Body = Limit(body, 180),
            DataJson = JsonSerializer.Serialize(data),
            UserIdsJson = JsonSerializer.Serialize(users?.Distinct().ToArray() ?? []),
            RolesJson = JsonSerializer.Serialize(roles?.Distinct().ToArray() ?? []),
            ExcludeUserId = excludeUserId, CreatedAt = now,
            ExpiresAt = data.GetValueOrDefault("type") is "tracking_lost" or "tracking_restored" ? now.AddMinutes(15)
                : now.AddHours(data.GetValueOrDefault("type") == "risk_alert" ? 1 : 6)
        });
    }

    public static Dictionary<string, string?> TripData(string type, int tripId) => new()
    { ["type"] = type, ["tab"] = "trips", ["tripId"] = tripId.ToString() };

    public static async Task DestinationChangedAsync(PrevencionAccidentesBusesContext db, ViajeDiario trip, int? actorId = null)
    {
        await AddAsync(db, $"destination:{trip.IdViaje}:{trip.RevisionDestino}", "Destino actualizado",
            $"Se actualizó el destino del viaje #{trip.IdViaje}. Abre Eunice para revisarlo.",
            TripData("trip_destination", trip.IdViaje), [trip.IdUsuario], Operators, actorId);
    }

    private static string Limit(string text, int max) => text.Length <= max ? text : text[..max];
}
