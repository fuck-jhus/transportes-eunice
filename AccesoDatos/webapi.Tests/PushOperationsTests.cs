using System.Net;
using System.Text.Json;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using webapi.Core;
using webapi.Services;

namespace webapi.Tests;

public class PushOperationsTests
{
    [Fact]
    public async Task Outbox_SurvivesANewContextRetriesAndPollsTheFinalReceipt()
    {
        var database = Guid.NewGuid().ToString();
        await using (var db = TestDb.Create(database))
        {
            Seed(db); await db.SaveChangesAsync();
            await PushOutbox.AddAsync(db, "one-event", "Aviso", "Operación guardada", PushOutbox.TripData("trip_finished", 1), [1]);
            await db.SaveChangesAsync();
        }
        var now = DateTime.UtcNow; var provider = new Provider { Offline = true };
        await using (var db = TestDb.Create(database))
        {
            await Dispatcher(db, provider).ProcessAsync(now);
            var job = Assert.Single(db.PushOutboxDeliveries);
            Assert.Equal("Pending", job.Status); Assert.True(job.NextAttemptAt > now);
        }
        provider.Offline = false;
        await using (var db = TestDb.Create(database))
        {
            await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(1));
            var job = Assert.Single(db.PushOutboxDeliveries);
            Assert.Equal("Receipt", job.Status); Assert.NotNull(job.TicketId);
        }
        await using (var db = TestDb.Create(database))
        {
            await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(17));
            Assert.Equal("Delivered", db.PushOutboxDeliveries.Single().Status);
            Assert.Equal(1, provider.Accepted); Assert.Equal(1, provider.ReceiptCalls);
        }
    }

    [Fact]
    public async Task Outbox_DoesNotSendAfterDeviceChangesOwnerOrUserBlocksTheSender()
    {
        await using var db = TestDb.Create(); Seed(db); db.Usuarios.Add(User(2)); await db.SaveChangesAsync();
        var now = DateTime.UtcNow; var provider = new Provider { Offline = true };
        await PushOutbox.AddAsync(db, "blocked-event", "Chat", "Privado", new Dictionary<string, string?> { ["senderId"] = "2" }, [1]);
        await db.SaveChangesAsync(); await Dispatcher(db, provider).ProcessAsync(now);
        db.UsuariosChatBloqueados.Add(new UsuarioChatBloqueado { IdUsuario = 1, IdUsuarioBloqueado = 2 }); await db.SaveChangesAsync();
        provider.Offline = false; await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(1));
        Assert.Equal("Cancelled", db.PushOutboxDeliveries.Single().Status); Assert.Equal(0, provider.Accepted);

        db.UsuariosChatBloqueados.RemoveRange(db.UsuariosChatBloqueados); await db.SaveChangesAsync();
        provider.Offline = true;
        await PushOutbox.AddAsync(db, "old-owner", "Chat", "Privado", new Dictionary<string, string?>(), [1]);
        await db.SaveChangesAsync(); await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(2));
        db.DispositivosPush.Single().IdUsuario = 2; await db.SaveChangesAsync();
        provider.Offline = false; await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(3));
        Assert.All(db.PushOutboxDeliveries, x => Assert.Equal("Cancelled", x.Status)); Assert.Equal(0, provider.Accepted);
    }

    [Fact]
    public async Task Outbox_LaterUninstallReceiptDisablesOnlyThatTokenAndExpiryStopsRetries()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var now = DateTime.UtcNow; var provider = new Provider { ReceiptError = "DeviceNotRegistered" };
        await PushOutbox.AddAsync(db, "one", "Aviso", "Texto", new Dictionary<string, string?>(), [1]); await db.SaveChangesAsync();
        await Dispatcher(db, provider).ProcessAsync(now); await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(16));
        Assert.False(db.DispositivosPush.Single().Activo); Assert.Equal("Cancelled", db.PushOutboxDeliveries.Single().Status);
        db.DispositivosPush.Single().Activo = true;
        await PushOutbox.AddAsync(db, "expired", "Aviso", "Texto", new Dictionary<string, string?>(), [1]); await db.SaveChangesAsync();
        provider.Offline = true; await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(17));
        var job = db.PushOutboxDeliveries.Single(x => x.Message.EventKey == "expired");
        job.Message.ExpiresAt = now; await db.SaveChangesAsync();
        var before = provider.Accepted; provider.Offline = false;
        await Dispatcher(db, provider).ProcessAsync(now.AddMinutes(18));
        Assert.Equal("Expired", job.Status); Assert.Equal(before, provider.Accepted);
    }

    [Fact]
    public async Task AllTripClosures_QueueOnceForThePilotAndOperations()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var trip = db.ViajesDiarios.Single();
        Assert.True(await TripLifecycle.FinishAsync(db, trip, "Relevo de conductor")); await db.SaveChangesAsync();
        Assert.False(await TripLifecycle.FinishAsync(db, trip, "Relevo de conductor")); await db.SaveChangesAsync();
        var message = Assert.Single(db.PushOutboxMessages);
        Assert.Contains("Relevo", message.Body); Assert.Contains("1", message.UserIdsJson); Assert.Contains("Supervisor", message.RolesJson);
    }

    [Fact]
    public async Task MonthlyEvaluation_ReprocessingDoesNotNotifyTwice()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var service = new EvaluacionService(db);
        await service.ProcesarEvaluacionesMensualesAsync(2026, 9);
        await service.ProcesarEvaluacionesMensualesAsync(2026, 9);
        Assert.Single(db.PushOutboxMessages); Assert.Contains("2026-09", db.PushOutboxMessages.Single().DataJson);
        db.PushOutboxMessages.RemoveRange(db.PushOutboxMessages); await db.SaveChangesAsync();
        await service.ProcesarEvaluacionesMensualesAsync(2026, 9);
        Assert.Empty(db.PushOutboxMessages); Assert.Single(db.PushNotificationMarkers);
    }

    [Fact]
    public async Task TrackingLoss_DebouncesRepeatsIgnoresOldUploadsAndSuppressesPrivacy()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var now = DateTime.UtcNow; var monitor = new TrackingNotificationMonitor(db);
        await monitor.CheckAsync(now); await monitor.CheckAsync(now.AddMinutes(4)); Assert.Empty(db.PushOutboxMessages);
        await monitor.CheckAsync(now.AddMinutes(6)); await monitor.CheckAsync(now.AddMinutes(7)); Assert.Single(db.PushOutboxMessages);
        db.TelemetriaIots.Add(new TelemetriaIot { IdViaje = 1, FechaHoraDispositivo = now.AddHours(-1), Latitud = 15, Longitud = -90 }); await db.SaveChangesAsync();
        await monitor.CheckAsync(now.AddMinutes(8)); Assert.Single(db.PushOutboxMessages);
        db.TelemetriaIots.Add(new TelemetriaIot { IdViaje = 1, FechaHoraDispositivo = now.AddMinutes(9), Latitud = 15, Longitud = -90, PrecisionMetros = 10 }); await db.SaveChangesAsync();
        await monitor.CheckAsync(now.AddMinutes(9)); Assert.Equal(2, db.PushOutboxMessages.Count());
        db.ViajesDiarios.Single().ModoPrivacidad = true; await db.SaveChangesAsync();
        await monitor.CheckAsync(now.AddHours(1)); Assert.Equal(2, db.PushOutboxMessages.Count());
    }

    [Fact]
    public async Task DelayedPush_DoesNotAnnounceAClosedAssignmentOrPrivacyPausedGps()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        await PushOutbox.AddAsync(db, "assigned", "Viaje", "Asignado", PushOutbox.TripData("trip_assignment", 1), [1]);
        await db.SaveChangesAsync(); db.ViajesDiarios.Single().EstadoViaje = "Finalizado"; await db.SaveChangesAsync();
        var provider = new Provider(); await Dispatcher(db, provider).ProcessAsync(DateTime.UtcNow);
        Assert.Equal(0, provider.Accepted);
        db.ViajesDiarios.Single().EstadoViaje = "En Curso"; db.ViajesDiarios.Single().ModoPrivacidad = true;
        await PushOutbox.AddAsync(db, "gps", "GPS", "Sin señal", PushOutbox.TripData("tracking_lost", 1), [1]); await db.SaveChangesAsync();
        await Dispatcher(db, provider).ProcessAsync(DateTime.UtcNow);
        Assert.Equal(0, provider.Accepted); Assert.All(db.PushOutboxDeliveries, x => Assert.Equal("Cancelled", x.Status));
    }

    private static PushOutboxDispatcher Dispatcher(PrevencionAccidentesBusesContext db, Provider provider) => new(db, provider, NullLogger<PushOutboxDispatcher>.Instance);
    private static Usuario User(int id) => new() { IdUsuario = id, NombreCompleto = "Pilot", UsuarioLogin = "pilot" + id, Contrasena = "fixture", Estado = "Activo", TipoRol = "Piloto" };
    private static void Seed(PrevencionAccidentesBusesContext db)
    {
        db.Usuarios.Add(User(1)); db.Autobuses.Add(new Autobus { IdAutobus = 1, Placa = "TEST", Estado = "Activo" });
        db.ViajesDiarios.Add(new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, FechaInicio = DateTime.UtcNow.AddHours(-1), EstadoViaje = "En Curso" });
        db.DispositivosPush.Add(new DispositivoPush { IdDispositivo = 1, IdUsuario = 1, ExpoPushToken = "ExpoPushToken[one]", Plataforma = "ios", Activo = true, FechaRegistro = DateTime.UtcNow.AddDays(-1) });
    }

    private sealed class Provider : HttpMessageHandler, IHttpClientFactory
    {
        public bool Offline; public string? ReceiptError; public int Accepted; public int ReceiptCalls;
        public HttpClient CreateClient(string name) => new(this, false) { BaseAddress = new Uri("https://provider.invalid/") };
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (Offline) throw new HttpRequestException("Offline");
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            if (request.RequestUri!.AbsolutePath.EndsWith("getReceipts"))
            {
                ReceiptCalls++;
                var data = json.RootElement.GetProperty("ids").EnumerateArray().ToDictionary(x => x.GetString()!, _ => ReceiptError == null
                    ? (object)new { status = "ok" } : new { status = "error", details = new { error = ReceiptError } });
                return Response(new { data });
            }
            Accepted += json.RootElement.GetArrayLength();
            return Response(new { data = json.RootElement.EnumerateArray().Select(_ => new { status = "ok", id = Guid.NewGuid().ToString() }).ToArray() });
        }
        private static HttpResponseMessage Response(object value) => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(value)) };
    }
}
