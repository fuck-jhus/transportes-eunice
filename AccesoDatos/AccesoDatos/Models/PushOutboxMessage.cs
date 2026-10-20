namespace AccesoDatos.Models;

public sealed class PushOutboxMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string EventKey { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string DataJson { get; set; } = "{}";
    public string UserIdsJson { get; set; } = "[]";
    public string RolesJson { get; set; } = "[]";
    public int? ExcludeUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddHours(6);
    public DateTime? ExpandedAt { get; set; }
}

public sealed class PushOutboxDelivery
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MessageId { get; set; }
    public PushOutboxMessage Message { get; set; } = null!;
    public int DeviceId { get; set; }
    public Guid RegistrationId { get; set; }
    public int UserId { get; set; }
    public string Token { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public string? TicketId { get; set; }
    public string? LastError { get; set; }
    public Guid? LeaseId { get; set; }
    public DateTime? LeaseUntil { get; set; }
}

public sealed class TrackingNotificationState
{
    public int TripId { get; set; }
    public DateTime MonitoredSince { get; set; }
    public DateTime? LostAt { get; set; }
}

public sealed class PushNotificationMarker
{
    public string EventKey { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
