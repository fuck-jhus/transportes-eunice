using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace webapi.Core;

public enum PublicTripAccessStatus { Ok, TripNotFound, TripNotActive, Unrecoverable }

public sealed record PublicTripAccessResult(PublicTripAccessStatus Status, ViajeAccesoPublico? Access = null, string? Token = null);

// Crea o recupera el enlace público de un viaje. Lo usan el panel (compartir enlace)
// y el QR fijo de cada bus, para que ambos apunten al mismo enlace del viaje.
public static class PublicTripAccess
{
    public const string ProtectorPurpose = "Eunice.PublicTripToken.v1";
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(72);

    public static async Task<PublicTripAccessResult> GetOrCreateAsync(
        PrevencionAccidentesBusesContext db,
        IDataProtector protector,
        int tripId,
        int? actorId,
        bool chatEnabled,
        bool rotate,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);
        await TripLifecycle.LockAsync(db, $"trip-access:{tripId}");
        var trip = await db.ViajesDiarios.SingleOrDefaultAsync(item => item.IdViaje == tripId, cancellationToken);
        if (trip is null) return new(PublicTripAccessStatus.TripNotFound);
        if (!string.Equals(trip.EstadoViaje, EstadosViaje.EnCurso, StringComparison.Ordinal))
            return new(PublicTripAccessStatus.TripNotActive);

        var now = DateTime.UtcNow;
        var previous = await db.ViajesAccesosPublicos
            .Where(item => item.IdViaje == tripId && item.FechaRevocacion == null)
            .ToListAsync(cancellationToken);
        var current = previous.FirstOrDefault(x => x.FechaExpiracion > now);
        if (current != null && !rotate)
        {
            if (current.TokenProtegido == null) return new(PublicTripAccessStatus.Unrecoverable, current);
            try
            {
                var savedToken = protector.Unprotect(current.TokenProtegido);
                return new(PublicTripAccessStatus.Ok, current, savedToken);
            }
            catch (System.Security.Cryptography.CryptographicException)
            {
                return new(PublicTripAccessStatus.Unrecoverable, current);
            }
        }

        foreach (var access in previous)
        {
            access.FechaRevocacion = now;
            access.FechaExpiracion = now;
        }

        var token = PublicTripToken.Create();
        var entity = new ViajeAccesoPublico
        {
            IdAcceso = Guid.NewGuid(),
            IdViaje = tripId,
            TokenHash = PublicTripToken.Hash(token),
            TokenProtegido = protector.Protect(token),
            FechaCreacion = now,
            FechaExpiracion = now.Add(Lifetime),
            ChatHabilitado = chatEnabled,
            IdCreadoPor = actorId
        };
        db.ViajesAccesosPublicos.Add(entity);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(PublicTripAccessStatus.Ok, entity, token);
    }
}
