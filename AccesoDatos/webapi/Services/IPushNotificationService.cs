namespace webapi.Services;

public interface IPushNotificationService
{
    Task RegisterDeviceAsync(
        int userId,
        string expoPushToken,
        string platform,
        string? deviceId,
        CancellationToken cancellationToken = default);

    Task UnregisterDeviceAsync(
        int userId,
        string expoPushToken,
        CancellationToken cancellationToken = default);

    Task SendToUsersAsync(
        IEnumerable<int> userIds,
        string title,
        string body,
        IReadOnlyDictionary<string, string?>? data = null,
        CancellationToken cancellationToken = default);

    Task SendToRolesAsync(
        IEnumerable<string> roles,
        string title,
        string body,
        IReadOnlyDictionary<string, string?>? data = null,
        int? excludeUserId = null,
        CancellationToken cancellationToken = default);
}
