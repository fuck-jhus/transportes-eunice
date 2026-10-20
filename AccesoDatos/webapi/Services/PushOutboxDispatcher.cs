using System.Data;
using System.Net.Http.Json;
using System.Text.Json;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using webapi.Core;

namespace webapi.Services;

public sealed class PushOutboxDispatcher(PrevencionAccidentesBusesContext db,
    IHttpClientFactory clients, ILogger<PushOutboxDispatcher> logger)
{
    public async Task ProcessAsync(DateTime now, CancellationToken ct = default)
    {
        await ExpandAsync(now, ct);
        var lease = Guid.NewGuid();
        var jobs = await DatabaseOperation.ExecuteAsync(db, async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await TripLifecycle.LockAsync(db, "push:claim");
            var due = await db.PushOutboxDeliveries.Include(x => x.Message)
                .Where(x => (x.Status == "Pending" || x.Status == "Receipt") && x.NextAttemptAt <= now
                    && (x.LeaseUntil == null || x.LeaseUntil < now))
                .OrderBy(x => x.NextAttemptAt).ThenBy(x => x.UserId).ThenBy(x => x.DeviceId).Take(100).ToListAsync(ct);
            foreach (var job in due) { job.LeaseId = lease; job.LeaseUntil = now.AddMinutes(2); }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
            return due;
        });
        var send = new List<PushOutboxDelivery>();
        foreach (var job in jobs)
        {
            if (job.Status == "Pending" && job.Message.ExpiresAt <= now) { job.Status = "Expired"; continue; }
            if (!await StillAuthorizedAsync(job, now, ct)) { job.Status = "Cancelled"; continue; }
            if (job.Status == "Pending") send.Add(job);
        }
        if (send.Count > 0) await SendAsync(send, now, ct);
        var receipts = jobs.Where(x => x.Status == "Receipt" && x.NextAttemptAt <= now && x.TicketId != null).ToList();
        if (receipts.Count > 0) await ReceiptsAsync(receipts, now, ct);
        foreach (var job in jobs) { job.LeaseId = null; job.LeaseUntil = null; }
        await db.SaveChangesAsync(ct);
    }

    private Task ExpandAsync(DateTime now, CancellationToken ct) => DatabaseOperation.ExecuteAsync(db, async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await TripLifecycle.LockAsync(db, "push:expand");
        var messages = await db.PushOutboxMessages.Where(x => x.ExpandedAt == null)
            .OrderBy(x => x.CreatedAt).Take(50).ToListAsync(ct);
        foreach (var message in messages)
        {
            if (message.ExpiresAt > now)
            {
                var users = JsonSerializer.Deserialize<int[]>(message.UserIdsJson) ?? [];
                var roles = JsonSerializer.Deserialize<string[]>(message.RolesJson) ?? [];
                var data = JsonSerializer.Deserialize<Dictionary<string, string?>>(message.DataJson) ?? [];
                var sender = int.TryParse(data.GetValueOrDefault("senderId"), out var id) ? id : 0;
                var devices = await db.DispositivosPush.AsNoTracking().Where(x => x.Activo
                    && x.IdUsuarioNavigation.Estado == "Activo" && x.BindingChangedAt <= message.CreatedAt
                    && (users.Contains(x.IdUsuario) || roles.Contains(x.IdUsuarioNavigation.TipoRol))
                    && (message.ExcludeUserId == null || x.IdUsuario != message.ExcludeUserId)
                    && (sender == 0 || !db.UsuariosChatBloqueados.Any(b => b.IdUsuario == x.IdUsuario && b.IdUsuarioBloqueado == sender)))
                    .Select(x => new { x.IdDispositivo, x.IdUsuario, x.ExpoPushToken, x.RegistrationId }).ToListAsync(ct);
                foreach (var device in devices)
                    db.PushOutboxDeliveries.Add(new PushOutboxDelivery
                    {
                        MessageId = message.Id, DeviceId = device.IdDispositivo, UserId = device.IdUsuario, RegistrationId = device.RegistrationId,
                        Token = device.ExpoPushToken, NextAttemptAt = now
                    });
            }
            message.ExpandedAt = now;
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    });

    private async Task<bool> StillAuthorizedAsync(PushOutboxDelivery job, DateTime now, CancellationToken ct)
    {
        var data = JsonSerializer.Deserialize<Dictionary<string, string?>>(job.Message.DataJson) ?? [];
        var sender = int.TryParse(data.GetValueOrDefault("senderId"), out var id) ? id : 0;
        var users = JsonSerializer.Deserialize<int[]>(job.Message.UserIdsJson) ?? [];
        var roles = JsonSerializer.Deserialize<string[]>(job.Message.RolesJson) ?? [];
        var type = data.GetValueOrDefault("type");
        if (int.TryParse(data.GetValueOrDefault("tripId"), out var tripId)
            && type is "trip_assignment" or "trip_destination" or "tracking_lost" or "tracking_restored")
        {
            var trip = await db.ViajesDiarios.AsNoTracking().SingleOrDefaultAsync(x => x.IdViaje == tripId && x.EstadoViaje == "En Curso", ct);
            if (trip == null) return false;
            if (type is "tracking_lost" or "tracking_restored")
            {
                if (trip.ModoPrivacidad) return false;
                var latest = await db.TelemetriaIots.Where(x => x.IdViaje == tripId && x.FechaHoraDispositivo <= now.AddSeconds(5)
                    && (x.PrecisionMetros == null || x.PrecisionMetros <= 50)).MaxAsync(x => (DateTime?)x.FechaHoraDispositivo, ct) ?? trip.FechaInicio;
                if (type == "tracking_lost" && latest > now.AddMinutes(-5)) return false;
                if (type == "tracking_restored" && latest < now.AddSeconds(-30)) return false;
            }
        }
        return await db.DispositivosPush.AnyAsync(x => x.IdDispositivo == job.DeviceId && x.IdUsuario == job.UserId
            && x.ExpoPushToken == job.Token && x.RegistrationId == job.RegistrationId && x.Activo && x.IdUsuarioNavigation.Estado == "Activo"
            && (users.Contains(x.IdUsuario) || roles.Contains(x.IdUsuarioNavigation.TipoRol))
            && (sender == 0 || !db.UsuariosChatBloqueados.Any(b => b.IdUsuario == x.IdUsuario && b.IdUsuarioBloqueado == sender)), ct);
    }

    private async Task SendAsync(List<PushOutboxDelivery> jobs, DateTime now, CancellationToken ct)
    {
        foreach (var job in jobs) job.Attempts++;
        var payload = jobs.Select(job =>
        {
            var data = JsonSerializer.Deserialize<Dictionary<string, string?>>(job.Message.DataJson) ?? [];
            data["recipientId"] = job.UserId.ToString(); data["notificationId"] = job.MessageId.ToString();
            return new { to = job.Token, sound = "default", title = job.Message.Title, body = job.Message.Body,
                priority = "high", channelId = "operaciones", ttl = Math.Max(1, (int)(job.Message.ExpiresAt - now).TotalSeconds), data };
        }).ToArray();
        try
        {
            using var response = await clients.CreateClient("ExpoPush").PostAsJsonAsync("send", payload, ct);
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                foreach (var job in jobs) Retry(job, now, $"HTTP{status}", status is 401 or 403 or 429 || status >= 500);
                return;
            }
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                throw new JsonException("Missing tickets");
            var tickets = data.EnumerateArray().ToArray();
            for (var i = 0; i < jobs.Count; i++)
            {
                var job = jobs[i];
                if (i >= tickets.Length) { Retry(job, now, "MissingTicket"); continue; }
                var ticket = tickets[i];
                if (ticket.TryGetProperty("status", out var status) && status.GetString() == "ok"
                    && ticket.TryGetProperty("id", out var ticketId) && !string.IsNullOrWhiteSpace(ticketId.GetString()))
                {
                    job.Status = "Receipt"; job.TicketId = ticketId.GetString(); job.AcceptedAt = now;
                    job.NextAttemptAt = now.AddMinutes(15); job.LastError = null;
                }
                else await HandleErrorAsync(job, ErrorCode(ticket), now, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            // Errors may include credentials or payloads. Persist only a fixed code.
            logger.LogWarning("Proveedor push temporalmente no disponible; los avisos permanecen en la cola.");
            foreach (var job in jobs) Retry(job, now, "ProviderUnavailable");
        }
    }

    private async Task ReceiptsAsync(List<PushOutboxDelivery> jobs, DateTime now, CancellationToken ct)
    {
        try
        {
            using var response = await clients.CreateClient("ExpoPush").PostAsJsonAsync("getReceipts",
                new { ids = jobs.Select(x => x.TicketId).Distinct().ToArray() }, ct);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (!doc.RootElement.TryGetProperty("data", out var receipts) || receipts.ValueKind != JsonValueKind.Object)
                throw new JsonException("Missing receipts");
            foreach (var job in jobs)
            {
                if (!receipts.TryGetProperty(job.TicketId!, out var receipt))
                {
                    job.NextAttemptAt = now.AddMinutes(15);
                    if (job.AcceptedAt <= now.AddHours(-24)) { job.Status = "Failed"; job.LastError = "ReceiptExpired"; }
                    continue;
                }
                if (receipt.TryGetProperty("status", out var status) && status.GetString() == "ok")
                { job.Status = "Delivered"; job.LastError = null; }
                else await HandleErrorAsync(job, ErrorCode(receipt), now, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            foreach (var job in jobs)
            {
                job.NextAttemptAt = now.AddMinutes(15); job.LastError = "ReceiptUnavailable";
                if (job.AcceptedAt <= now.AddHours(-24)) job.Status = "Failed";
            }
        }
    }

    private async Task HandleErrorAsync(PushOutboxDelivery job, string code, DateTime now, CancellationToken ct)
    {
        if (code == "DeviceNotRegistered")
        {
            var device = await db.DispositivosPush.SingleOrDefaultAsync(x => x.IdDispositivo == job.DeviceId
                && x.IdUsuario == job.UserId && x.ExpoPushToken == job.Token && x.RegistrationId == job.RegistrationId, ct);
            if (device != null) device.Activo = false;
            job.Status = "Cancelled"; job.LastError = code;
        }
        else Retry(job, now, code, code is not ("MessageTooBig" or "UnknownError"));
    }

    private static string ErrorCode(JsonElement item) => item.TryGetProperty("details", out var details)
        && details.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String
        && error.GetString() is "DeviceNotRegistered" or "InvalidCredentials" or "MismatchSenderId" or "MessageTooBig" or "MessageRateExceeded"
            ? error.GetString()! : "UnknownError";

    private static void Retry(PushOutboxDelivery job, DateTime now, string code, bool transient = true)
    {
        job.LastError = code; job.TicketId = null;
        if (!transient || job.Attempts >= 12 || job.Message.ExpiresAt <= now) { job.Status = "Failed"; return; }
        job.Status = "Pending";
        job.NextAttemptAt = now.AddSeconds(Math.Min(1800, 10 * Math.Pow(2, Math.Min(job.Attempts, 8))));
    }
}
