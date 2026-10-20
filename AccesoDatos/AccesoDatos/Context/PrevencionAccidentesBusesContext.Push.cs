using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;

namespace AccesoDatos.Context;

public partial class PrevencionAccidentesBusesContext
{
    public DbSet<PushOutboxMessage> PushOutboxMessages { get; set; }
    public DbSet<PushOutboxDelivery> PushOutboxDeliveries { get; set; }
    public DbSet<TrackingNotificationState> TrackingNotificationStates { get; set; }
    public DbSet<GuestPushSubscription> GuestPushSubscriptions { get; set; }
    public DbSet<GuestPushJob> GuestPushJobs { get; set; }
    public DbSet<GuestPushKeys> GuestPushKeyRing { get; set; }
    public DbSet<PushNotificationMarker> PushNotificationMarkers { get; set; }

    private static void ConfigurePushModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DispositivoPush>().Property(x => x.RegistrationId).HasColumnName("registration_id");
        modelBuilder.Entity<DispositivoPush>().Property(x => x.BindingChangedAt).HasColumnName("binding_changed_at");
        modelBuilder.Entity<PushNotificationMarker>(e =>
        {
            e.ToTable("push_notification_marker"); e.HasKey(x => x.EventKey); e.Property(x => x.EventKey).HasMaxLength(200);
        });
        modelBuilder.Entity<GuestPushSubscription>(e =>
        {
            e.ToTable("guest_push_subscription"); e.HasKey(x => x.Id);
            e.Property(x => x.EndpointHash).HasMaxLength(64);
            e.Property(x => x.Endpoint).HasMaxLength(2048);
            e.Property(x => x.P256dh).HasMaxLength(100); e.Property(x => x.Auth).HasMaxLength(100);
            e.Property(x => x.ProtectedUrl).HasMaxLength(2048);
            e.HasIndex(x => x.ConversationId).IsUnique(); e.HasIndex(x => x.EndpointHash).IsUnique();
        });
        modelBuilder.Entity<GuestPushJob>(e =>
        {
            e.ToTable("guest_push_job"); e.HasKey(x => x.Id);
            e.Property(x => x.Status).HasMaxLength(20); e.Property(x => x.LastError).HasMaxLength(50);
            e.HasIndex(x => new { x.Status, x.NextAttemptAt, x.LeaseUntil }).HasDatabaseName("IX_guest_push_due");
        });
        modelBuilder.Entity<GuestPushKeys>(e =>
        {
            e.ToTable("guest_push_keys"); e.HasKey(x => x.Id); e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.PublicKey).HasMaxLength(100); e.Property(x => x.ProtectedPrivateKey).HasMaxLength(2048);
        });
        modelBuilder.Entity<PushOutboxMessage>(e =>
        {
            e.ToTable("push_outbox_message"); e.HasKey(x => x.Id);
            e.Property(x => x.EventKey).HasMaxLength(200);
            e.Property(x => x.Title).HasMaxLength(100);
            e.Property(x => x.Body).HasMaxLength(180);
            e.HasIndex(x => x.EventKey).IsUnique().HasDatabaseName("UX_push_outbox_event");
            e.HasIndex(x => new { x.ExpandedAt, x.CreatedAt }).HasDatabaseName("IX_push_outbox_expand");
        });
        modelBuilder.Entity<PushOutboxDelivery>(e =>
        {
            e.ToTable("push_outbox_delivery"); e.HasKey(x => x.Id);
            e.Property(x => x.Token).HasMaxLength(200);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.TicketId).HasMaxLength(200);
            e.Property(x => x.LastError).HasMaxLength(50);
            e.HasOne(x => x.Message).WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.MessageId, x.DeviceId }).IsUnique().HasDatabaseName("UX_push_delivery_device");
            e.HasIndex(x => new { x.Status, x.NextAttemptAt, x.LeaseUntil }).HasDatabaseName("IX_push_delivery_due");
        });
        modelBuilder.Entity<TrackingNotificationState>(e =>
        {
            e.ToTable("tracking_notification_state"); e.HasKey(x => x.TripId);
            e.Property(x => x.TripId).ValueGeneratedNever();
        });
    }
}
