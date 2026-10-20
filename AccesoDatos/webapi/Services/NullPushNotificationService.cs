namespace webapi.Services;

internal sealed class NullPushNotificationService : IPushNotificationService
{
    public static NullPushNotificationService Instance { get; } = new();

    private NullPushNotificationService()
    {
    }

    public Task RegisterDeviceAsync(int userId, string expoPushToken, string platform, string? deviceId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task UnregisterDeviceAsync(int userId, string expoPushToken, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task SendToUsersAsync(IEnumerable<int> userIds, string title, string body, IReadOnlyDictionary<string, string?>? data = null, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task SendToRolesAsync(IEnumerable<string> roles, string title, string body, IReadOnlyDictionary<string, string?>? data = null, int? excludeUserId = null, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
