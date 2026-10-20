using System.Net;
using System.Text.Json;
using AccesoDatos.Models;
using Microsoft.Extensions.Logging.Abstractions;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Tests;

public class PushNotificationTests
{
    [Fact]
    public async Task Registration_RotatesInstallationTokenAndTransfersOnlyItsOwnership()
    {
        await using var db = TestDb.Create();
        db.Usuarios.AddRange(User(1), User(2)); await db.SaveChangesAsync();
        var service = new ExpoPushNotificationService(db, new Provider(), NullLogger<ExpoPushNotificationService>.Instance);
        await service.RegisterDeviceAsync(1, "ExpoPushToken[old]", "android", "phone");
        await service.RegisterDeviceAsync(1, "ExpoPushToken[other]", "ios", "other-phone");
        await service.RegisterDeviceAsync(2, "ExpoPushToken[new]", "android", "phone");
        Assert.False(db.DispositivosPush.Single(x => x.ExpoPushToken == "ExpoPushToken[old]").Activo);
        Assert.True(db.DispositivosPush.Single(x => x.ExpoPushToken == "ExpoPushToken[other]").Activo);
        await service.RegisterDeviceAsync(1, "ExpoPushToken[new]", "android", "phone");
        Assert.Equal(1, db.DispositivosPush.Single(x => x.ExpoPushToken == "ExpoPushToken[new]").IdUsuario);
        Assert.Equal(3, db.DispositivosPush.Count());
        await service.UnregisterDeviceAsync(2, "ExpoPushToken[new]");
        Assert.True(db.DispositivosPush.Single(x => x.ExpoPushToken == "ExpoPushToken[new]").Activo);
        await service.UnregisterDeviceAsync(1, "ExpoPushToken[new]");
        Assert.False(db.DispositivosPush.Single(x => x.ExpoPushToken == "ExpoPushToken[new]").Activo);
    }

    [Theory]
    [InlineData("not-a-token", "ios")]
    [InlineData("ExpoPushToken[token]", "web")]
    public async Task Registration_RejectsInvalidInput(string token, string platform)
    {
        await using var db = TestDb.Create(); db.Usuarios.Add(User(1)); await db.SaveChangesAsync();
        var service = new ExpoPushNotificationService(db, new Provider(), NullLogger<ExpoPushNotificationService>.Instance);
        await Assert.ThrowsAsync<ArgumentException>(() => service.RegisterDeviceAsync(1, token, platform, "phone"));
        Assert.Empty(db.DispositivosPush);
    }

    [Fact]
    public async Task Delivery_ExcludesInactiveUsersBlockedSendersAndDuplicateRecipients()
    {
        await using var db = TestDb.Create();
        db.Usuarios.AddRange(User(1), User(2, "Inactivo"), User(3), User(4));
        db.DispositivosPush.AddRange(Device(1), Device(2), Device(3));
        db.UsuariosChatBloqueados.Add(new UsuarioChatBloqueado { IdUsuario = 3, IdUsuarioBloqueado = 4 });
        await db.SaveChangesAsync();
        var provider = new Provider(); var service = new ExpoPushNotificationService(db, provider, NullLogger<ExpoPushNotificationService>.Instance);
        await service.SendToUsersAsync([1, 1, 2, 3], "Chat", "Mensaje", new Dictionary<string, string?> { ["senderId"] = "4", ["tab"] = "chat" });
        Assert.Empty(provider.Batches); // Sending is deferred until after the operation commits.
        await new PushOutboxDispatcher(db, provider, NullLogger<PushOutboxDispatcher>.Instance).ProcessAsync(DateTime.UtcNow);
        var message = Assert.Single(Assert.Single(provider.Batches));
        Assert.Equal("ExpoPushToken[1]", message.GetProperty("to").GetString());
        Assert.Equal("operaciones", message.GetProperty("channelId").GetString());
        Assert.Equal("high", message.GetProperty("priority").GetString());
        Assert.Equal("default", message.GetProperty("sound").GetString());
        Assert.Equal("chat", message.GetProperty("data").GetProperty("tab").GetString());
        Assert.Equal("1", message.GetProperty("data").GetProperty("recipientId").GetString());
    }

    [Fact]
    public async Task Delivery_DisablesUninstalledTokenButKeepsCredentialFailuresRetryable()
    {
        await using var db = TestDb.Create(); db.Usuarios.AddRange(User(1), User(2)); db.DispositivosPush.AddRange(Device(1), Device(2)); await db.SaveChangesAsync();
        var provider = new Provider { Response = "{\"data\":[{\"status\":\"error\",\"details\":{\"error\":\"DeviceNotRegistered\"}},{\"status\":\"error\",\"details\":{\"error\":\"InvalidCredentials\"}}]}" };
        await new ExpoPushNotificationService(db, provider, NullLogger<ExpoPushNotificationService>.Instance).SendToUsersAsync([1, 2], "Test", "Aviso");
        await new PushOutboxDispatcher(db, provider, NullLogger<PushOutboxDispatcher>.Instance).ProcessAsync(DateTime.UtcNow);
        Assert.False(db.DispositivosPush.Single(x => x.IdUsuario == 1).Activo);
        Assert.True(db.DispositivosPush.Single(x => x.IdUsuario == 2).Activo);
    }

    [Fact]
    public async Task ProviderFailure_DoesNotFailBusinessOperation()
    {
        await using var db = TestDb.Create(); db.Usuarios.Add(User(1)); db.DispositivosPush.Add(Device(1)); await db.SaveChangesAsync();
        var provider = new Provider { Fail = true };
        await new ExpoPushNotificationService(db, provider, NullLogger<ExpoPushNotificationService>.Instance).SendToUsersAsync([1], "Aviso", "Operación");
        await new PushOutboxDispatcher(db, provider, NullLogger<PushOutboxDispatcher>.Instance).ProcessAsync(DateTime.UtcNow);
        Assert.True(db.DispositivosPush.Single().Activo);
        Assert.Equal("Pending", db.PushOutboxDeliveries.Single().Status);
        Assert.True(db.PushOutboxDeliveries.Single().NextAttemptAt > DateTime.UtcNow);
    }

    [Fact]
    public async Task BusAssignment_NotifiesOnlyNewAssignmentAndRouteChangeAfterCommit()
    {
        await using var db = TestDb.Create(); db.Usuarios.Add(User(1)); db.Ruta.Add(new Rutum { IdRuta = 1, NombreRuta = "A-B", Origen = "A", Destino = "B" }); await db.SaveChangesAsync();
        var push = new RecordingPush(); var service = new AutobusService(db, push);
        var bus = await service.CrearAutobusAsync(new CrearAutobusDto { Placa = "P-TEST", Estado = "Activo", IdPilotoAsignado = 1 });
        Assert.Single(push.Calls);
        var trip = Assert.Single(db.ViajesDiarios);
        Assert.Equal(trip.IdViaje.ToString(), push.Calls[0].Data?["tripId"]);
        await service.EditarAutobusAsync(bus.IdAutobus, new EditarAutobusDto { Placa = "P-TEST", Estado = "Activo" });
        Assert.Single(push.Calls);
        var change = new EditarAutobusDto { Placa = "P-TEST", Estado = "Activo", GestionarAsignacion = true, IdViajeEsperado = trip.IdViaje, IdPilotoAsignado = 1, IdRutaAsignada = 1 };
        await service.EditarAutobusAsync(bus.IdAutobus, change);
        Assert.Equal(2, push.Calls.Count); Assert.Equal("Destino actualizado", push.Calls[1].Title);
        await service.EditarAutobusAsync(bus.IdAutobus, change); Assert.Equal(2, push.Calls.Count);
    }

    private static Usuario User(int id, string state = "Activo") => new() { IdUsuario = id, NombreCompleto = $"Pilot {id}", UsuarioLogin = $"pilot-{id}", Contrasena = "hash", TipoRol = "Piloto", Estado = state };
    private static DispositivoPush Device(int id) => new() { IdUsuario = id, ExpoPushToken = $"ExpoPushToken[{id}]", Plataforma = "ios", Activo = true, FechaRegistro = DateTime.UtcNow, FechaUltimoUso = DateTime.UtcNow };

    private sealed class Provider : HttpMessageHandler, IHttpClientFactory
    {
        public List<JsonElement[]> Batches { get; } = [];
        public string Response { get; set; } = "{\"data\":[{\"status\":\"ok\",\"id\":\"ticket\"}]}";
        public bool Fail { get; set; }
        public HttpClient CreateClient(string name) => new(this, false) { BaseAddress = new Uri("https://provider.invalid/") };
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (Fail) throw new HttpRequestException("Provider unavailable");
            using var doc = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            Batches.Add(doc.RootElement.EnumerateArray().Select(item => item.Clone()).ToArray());
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Response) };
        }
    }

    private sealed class RecordingPush : IPushNotificationService
    {
        public List<(string Title, IReadOnlyDictionary<string, string?>? Data)> Calls { get; } = [];
        public Task RegisterDeviceAsync(int id, string token, string platform, string? device, CancellationToken ct = default) => Task.CompletedTask;
        public Task UnregisterDeviceAsync(int id, string token, CancellationToken ct = default) => Task.CompletedTask;
        public Task SendToUsersAsync(IEnumerable<int> ids, string title, string body, IReadOnlyDictionary<string, string?>? data = null, CancellationToken cancellationToken = default) { Calls.Add((title, data)); return Task.CompletedTask; }
        public Task SendToRolesAsync(IEnumerable<string> roles, string title, string body, IReadOnlyDictionary<string, string?>? data = null, int? excludeUserId = null, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
