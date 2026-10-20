using System.Data;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;

namespace webapi.Services;

public sealed class ExpoPushNotificationService : IPushNotificationService
{
    private readonly PrevencionAccidentesBusesContext _context;

    public ExpoPushNotificationService(
        PrevencionAccidentesBusesContext context,
        IHttpClientFactory httpClientFactory,
        ILogger<ExpoPushNotificationService> logger)
    {
        _context = context;
    }

    public async Task RegisterDeviceAsync(
        int userId,
        string expoPushToken,
        string platform,
        string? deviceId,
        CancellationToken cancellationToken = default)
    {
        var token = expoPushToken.Trim();
        if (!IsExpoPushToken(token))
        {
            throw new ArgumentException("El token push recibido no es válido.", nameof(expoPushToken));
        }

        var normalizedPlatform = platform.Trim().ToLowerInvariant();
        if (normalizedPlatform is not ("ios" or "android"))
        {
            throw new ArgumentException("La plataforma del dispositivo no es válida.", nameof(platform));
        }

        var userExists = await _context.Usuarios
            .AsNoTracking()
            .AnyAsync(item => item.IdUsuario == userId && item.Estado == "Activo", cancellationToken);
        if (!userExists)
        {
            throw new InvalidOperationException("El usuario no existe o está inactivo.");
        }

        await webapi.Core.DatabaseOperation.ExecuteAsync(_context, async () =>
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
            // Registration is infrequent. Serialize ownership/rotation across installations and tokens,
            // including two concurrent first registrations (the unique token index remains the backstop).
            await webapi.Core.TripLifecycle.LockAsync(_context, "eunice:push-registry");
            var now = DateTime.UtcNow;
            var installation = NormalizeDeviceId(deviceId);
            var obsolete = installation == null ? [] : await _context.DispositivosPush
                .Where(item => item.DeviceId == installation && item.Plataforma == normalizedPlatform
                    && item.ExpoPushToken != token && item.Activo)
                .ToListAsync(cancellationToken);
            foreach (var previous in obsolete)
            {
                previous.Activo = false;
                previous.FechaUltimoUso = now;
            }
            var device = await _context.DispositivosPush
                .SingleOrDefaultAsync(item => item.ExpoPushToken == token, cancellationToken);
            if (device is null)
            {
                device = new DispositivoPush
                {
                    IdUsuario = userId,
                    ExpoPushToken = token,
                    Plataforma = normalizedPlatform,
                    DeviceId = installation,
                    Activo = true,
                    FechaRegistro = now,
                    FechaUltimoUso = now
                };
                _context.DispositivosPush.Add(device);
            }
            else
            {
                if (device.IdUsuario != userId || !device.Activo || device.DeviceId != installation || device.Plataforma != normalizedPlatform)
                { device.RegistrationId = Guid.NewGuid(); device.BindingChangedAt = now; }
                device.IdUsuario = userId;
                device.Plataforma = normalizedPlatform;
                device.DeviceId = installation;
                device.Activo = true;
                device.FechaUltimoUso = now;
            }

            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task UnregisterDeviceAsync(
        int userId,
        string expoPushToken,
        CancellationToken cancellationToken = default)
    {
        var token = expoPushToken.Trim();
        await webapi.Core.DatabaseOperation.ExecuteAsync(_context, async () =>
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
            await webapi.Core.TripLifecycle.LockAsync(_context, "eunice:push-registry");
            var devices = await _context.DispositivosPush
                .Where(item => item.IdUsuario == userId && item.ExpoPushToken == token && item.Activo)
                .ToListAsync(cancellationToken);
            foreach (var device in devices)
            {
                device.Activo = false;
                device.FechaUltimoUso = DateTime.UtcNow;
            }
            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task SendToUsersAsync(IEnumerable<int> userIds, string title, string body,
        IReadOnlyDictionary<string, string?>? data = null, CancellationToken cancellationToken = default)
    {
        var payload = data ?? new Dictionary<string, string?>();
        var key = payload.GetValueOrDefault("eventKey") ?? Guid.NewGuid().ToString("N");
        await PushOutbox.AddAsync(_context, key + ":users", title, body, payload, users: userIds, ct: cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task SendToRolesAsync(IEnumerable<string> roles, string title, string body,
        IReadOnlyDictionary<string, string?>? data = null, int? excludeUserId = null, CancellationToken cancellationToken = default)
    {
        var payload = data ?? new Dictionary<string, string?>();
        var key = payload.GetValueOrDefault("eventKey") ?? Guid.NewGuid().ToString("N");
        await PushOutbox.AddAsync(_context, key + ":roles", title, body, payload, roles: roles,
            excludeUserId: excludeUserId, ct: cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    private static bool IsExpoPushToken(string token) =>
        (token.StartsWith("ExponentPushToken[", StringComparison.Ordinal)
            || token.StartsWith("ExpoPushToken[", StringComparison.Ordinal))
        && token.EndsWith(']');

    private static Dictionary<string, string?> RecipientData(IReadOnlyDictionary<string, string?>? data, int userId)
    {
        var result = data?.ToDictionary(item => item.Key, item => item.Value) ?? [];
        result["recipientId"] = userId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return result;
    }

    private static string? NormalizeDeviceId(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : Truncate(value.Trim(), 120);

    private static string Truncate(string value, int length) =>
        value.Length <= length ? value : value[..length];
}
