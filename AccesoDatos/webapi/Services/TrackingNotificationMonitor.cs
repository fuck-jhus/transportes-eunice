using System.Data;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using webapi.Core;

namespace webapi.Services;

public sealed class TrackingNotificationMonitor(PrevencionAccidentesBusesContext db)
{
    public Task CheckAsync(DateTime now, CancellationToken ct = default) => DatabaseOperation.ExecuteAsync(db, async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await TripLifecycle.LockAsync(db, "push:gps-monitor");
        var trips = await db.ViajesDiarios.AsNoTracking().Where(x => x.EstadoViaje == "En Curso")
            .Select(x => new { x.IdViaje, x.ModoPrivacidad, x.FechaInicio, x.PlacaSnapshot }).ToListAsync(ct);
        var ids = trips.Select(x => x.IdViaje).ToArray();
        var states = await db.TrackingNotificationStates.Where(x => ids.Contains(x.TripId)).ToDictionaryAsync(x => x.TripId, ct);
        var positions = await db.TelemetriaIots.AsNoTracking().Where(x => ids.Contains(x.IdViaje)
            && x.FechaHoraDispositivo <= now.AddSeconds(5) && (x.PrecisionMetros == null || x.PrecisionMetros <= 50))
            .GroupBy(x => x.IdViaje).Select(g => new { TripId = g.Key, Latest = g.Max(x => x.FechaHoraDispositivo) }).ToDictionaryAsync(x => x.TripId, ct);
        foreach (var trip in trips)
        {
            if (!states.TryGetValue(trip.IdViaje, out var state))
            {
                state = new TrackingNotificationState { TripId = trip.IdViaje, MonitoredSince = now };
                db.TrackingNotificationStates.Add(state);
            }
            if (trip.ModoPrivacidad) { state.MonitoredSince = now; state.LostAt = null; continue; }
            var latest = positions.TryGetValue(trip.IdViaje, out var point) ? point.Latest : trip.FechaInicio;
            if (state.LostAt == null && latest < now.AddMinutes(-5) && state.MonitoredSince <= now.AddMinutes(-5))
            {
                state.LostAt = now;
                await PushOutbox.AddAsync(db, $"gps-lost:{trip.IdViaje}:{now.Ticks}", "Unidad sin posición reciente",
                    $"{trip.PlacaSnapshot ?? "Unidad"}: llevamos más de cinco minutos sin una posición GPS reciente.",
                    PushOutbox.TripData("tracking_lost", trip.IdViaje), roles: PushOutbox.Operators, ct: ct);
            }
            else if (state.LostAt != null && latest >= now.AddSeconds(-30))
            {
                await PushOutbox.AddAsync(db, $"gps-restored:{trip.IdViaje}:{state.LostAt.Value.Ticks}", "Rastreo recuperado",
                    $"{trip.PlacaSnapshot ?? "Unidad"} volvió a transmitir una posición reciente.",
                    PushOutbox.TripData("tracking_restored", trip.IdViaje), roles: PushOutbox.Operators, ct: ct);
                state.LostAt = null;
            }
        }
        // Bound retention of token/message snapshots and stale monitoring rows.
        var old = await db.PushOutboxMessages.Where(x => x.CreatedAt < now.AddDays(-7)).Take(100).ToListAsync(ct);
        db.PushOutboxMessages.RemoveRange(old);
        var inactive = await db.TrackingNotificationStates.Where(x => !ids.Contains(x.TripId)).ToListAsync(ct);
        db.TrackingNotificationStates.RemoveRange(inactive);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    });
}
