namespace AccesoDatos.Models;

public sealed class GuestPushSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public Guid Revision { get; set; } = Guid.NewGuid();
    public string EndpointHash { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public string ProtectedUrl { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTime ExpiresAt { get; set; }
}

public sealed class GuestPushJob
{
    public Guid Id { get; set; }
    public Guid SubscriptionId { get; set; }
    public Guid SubscriptionRevision { get; set; }
    public string Status { get; set; } = "Pending";
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public Guid? LeaseId { get; set; }
    public DateTime? LeaseUntil { get; set; }
    public string? LastError { get; set; }
}

public sealed class GuestPushKeys
{
    public int Id { get; set; }
    public string PublicKey { get; set; } = "";
    public string ProtectedPrivateKey { get; set; } = "";
}
