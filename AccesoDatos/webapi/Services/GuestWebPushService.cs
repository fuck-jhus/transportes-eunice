using System.Data;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using webapi.Core;

namespace webapi.Services;

public sealed class GuestWebPushService(PrevencionAccidentesBusesContext db, IDataProtectionProvider protection,
    IHttpClientFactory clients)
{
    private IDataProtector Protector => protection.CreateProtector("Eunice.GuestWebPush.v1");

    public Task<GuestPushKeys> GetKeysAsync(CancellationToken ct = default) => DatabaseOperation.ExecuteAsync(db, async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await TripLifecycle.LockAsync(db, "push:guest-keys");
        var keys = await db.GuestPushKeyRing.SingleOrDefaultAsync(x => x.Id == 1, ct);
        if (keys == null)
        {
            using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var parameters = ec.ExportParameters(true);
            keys = new GuestPushKeys { Id = 1,
                PublicKey = WebEncoders.Base64UrlEncode([4, ..parameters.Q.X!, ..parameters.Q.Y!]),
                ProtectedPrivateKey = Protector.Protect(WebEncoders.Base64UrlEncode(parameters.D!)) };
            db.GuestPushKeyRing.Add(keys); await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct); return keys;
    });

    public static bool ValidEndpoint(string endpoint) => Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
        && endpoint.Length <= 2048 && uri.Scheme == "https" && uri.Port == 443 && uri.UserInfo.Length == 0
        && uri.Fragment.Length == 0 && (uri.Host == "fcm.googleapis.com" || uri.Host == "web.push.apple.com"
            || uri.Host.EndsWith(".push.services.mozilla.com", StringComparison.OrdinalIgnoreCase)
            || uri.Host.EndsWith(".notify.windows.com", StringComparison.OrdinalIgnoreCase));

    public static bool ValidKeys(string publicKey, string auth)
    {
        try
        {
            var bytes = WebEncoders.Base64UrlDecode(publicKey);
            if (bytes.Length != 65 || bytes[0] != 4 || WebEncoders.Base64UrlDecode(auth).Length != 16) return false;
            using var ec = ECDiffieHellman.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = bytes[1..33], Y = bytes[33..65] } });
            return true;
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException or ArgumentException) { return false; }
    }

    public Task SubscribeAsync(Guid conversationId, string token, DateTime expires, string endpoint,
        string publicKey, string auth, CancellationToken ct = default) => DatabaseOperation.ExecuteAsync(db, async () =>
    {
        if (!ValidEndpoint(endpoint) || !ValidKeys(publicKey, auth)) throw new ArgumentException("La suscripción del navegador no es válida.");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await TripLifecycle.LockAsync(db, "push:guest-subscriptions");
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(endpoint)));
        var previous = await db.GuestPushSubscriptions.Where(x => x.EndpointHash == hash || x.ConversationId == conversationId).ToListAsync(ct);
        db.GuestPushSubscriptions.RemoveRange(previous);
        await db.SaveChangesAsync(ct);
        db.GuestPushSubscriptions.Add(new GuestPushSubscription { ConversationId = conversationId,
            EndpointHash = hash, Endpoint = endpoint, P256dh = publicKey, Auth = auth,
            ProtectedUrl = Protector.Protect("/viaje/" + token), ExpiresAt = expires });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    });

    public static async Task QueueReplyAsync(PrevencionAccidentesBusesContext db, Guid conversationId, Guid messageId, CancellationToken ct = default)
    {
        var subscription = await db.GuestPushSubscriptions.AsNoTracking().SingleOrDefaultAsync(x =>
            x.ConversationId == conversationId && x.Active && x.ExpiresAt > DateTime.UtcNow, ct);
        if (subscription != null)
            db.GuestPushJobs.Add(new GuestPushJob { Id = messageId, SubscriptionId = subscription.Id,
                SubscriptionRevision = subscription.Revision, NextAttemptAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddHours(1) });
    }

    public async Task ProcessAsync(DateTime now, CancellationToken ct = default)
    {
        var lease = Guid.NewGuid();
        var jobs = await DatabaseOperation.ExecuteAsync(db, async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await TripLifecycle.LockAsync(db, "push:guest-claim");
            var due = await db.GuestPushJobs.Where(x => x.Status == "Pending" && x.NextAttemptAt <= now
                && (x.LeaseUntil == null || x.LeaseUntil < now)).OrderBy(x => x.NextAttemptAt).Take(10).ToListAsync(ct);
            foreach (var job in due) { job.LeaseId = lease; job.LeaseUntil = now.AddMinutes(10); }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return due;
        });
        foreach (var job in jobs)
        {
            if (job.ExpiresAt <= now) { job.Status = "Expired"; continue; }
            var subscription = await db.GuestPushSubscriptions.SingleOrDefaultAsync(x => x.Id == job.SubscriptionId
                && x.Revision == job.SubscriptionRevision && x.Active && x.ExpiresAt > now, ct);
            var conversation = subscription == null ? null : await db.ConversacionesPasajeros.AsNoTracking()
                .Include(x => x.IdAccesoNavigation).ThenInclude(x => x.IdViajeNavigation)
                .SingleOrDefaultAsync(x => x.IdConversacion == subscription.ConversationId && !x.Bloqueada, ct);
            if (subscription == null || conversation == null || !conversation.IdAccesoNavigation.ChatHabilitado
                || conversation.IdAccesoNavigation.FechaRevocacion != null || conversation.IdAccesoNavigation.FechaExpiracion <= now
                || conversation.IdAccesoNavigation.IdViajeNavigation.EstadoViaje != "En Curso")
            { job.Status = "Cancelled"; continue; }
            job.Attempts++;
            try
            {
                var keys = await GetKeysAsync(ct);
                using var vapid = new VapidAuthentication(keys.PublicKey, Protector.Unprotect(keys.ProtectedPrivateKey))
                    { Subject = "https://transporteseunice.com/soporte" };
                using var http = clients.CreateClient("GuestWebPush");
                var client = new PushServiceClient(http) { AutoRetryAfter = false };
                var target = new PushSubscription { Endpoint = subscription.Endpoint,
                    Keys = new Dictionary<string, string> { ["p256dh"] = subscription.P256dh, ["auth"] = subscription.Auth } };
                var payload = JsonSerializer.Serialize(new { title = "Respuesta de Transportes Eunice",
                    body = "El conductor o el centro de control respondió a tu conversación.",
                    url = Protector.Unprotect(subscription.ProtectedUrl), notificationId = job.Id.ToString() });
                await client.RequestPushMessageDeliveryAsync(target, new PushMessage(payload)
                    { TimeToLive = 300, Topic = job.Id.ToString("N") }, vapid, ct);
                job.Status = "Delivered"; job.LastError = null;
            }
            catch (PushServiceClientException ex)
            {
                var status = (int)ex.StatusCode;
                if (ex.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound)
                { subscription.Active = false; job.Status = "Cancelled"; }
                else if (status is 401 or 403 or 429 || status >= 500) Retry(job, now, $"HTTP{status}");
                else { job.Status = "Failed"; job.LastError = $"HTTP{status}"; }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or CryptographicException)
            { Retry(job, now, "ProviderUnavailable"); }
        }
        foreach (var job in jobs) { job.LeaseId = null; job.LeaseUntil = null; }
        var oldJobs = await db.GuestPushJobs.Where(x => x.ExpiresAt < now.AddDays(-1)).Take(100).ToListAsync(ct);
        db.GuestPushJobs.RemoveRange(oldJobs);
        var oldSubscriptions = await db.GuestPushSubscriptions.Where(x => x.ExpiresAt < now.AddDays(-1)).Take(100).ToListAsync(ct);
        db.GuestPushSubscriptions.RemoveRange(oldSubscriptions);
        await db.SaveChangesAsync(ct);
    }

    private static void Retry(GuestPushJob job, DateTime now, string code)
    {
        job.LastError = code; job.Status = job.Attempts >= 10 ? "Failed" : "Pending";
        job.NextAttemptAt = now.AddSeconds(Math.Min(900, 10 * Math.Pow(2, Math.Min(job.Attempts, 7))));
    }
}
