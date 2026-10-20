using System.Net;
using System.Security.Claims;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using webapi.Controllers;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Tests;

public sealed class PolishRegressionTests
{
    private static void Seed(AccesoDatos.Context.PrevencionAccidentesBusesContext db)
    {
        db.Usuarios.Add(new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" });
        db.Autobuses.Add(new Autobus { IdAutobus = 1, Placa = "REG-" + Guid.NewGuid().ToString("N"), Estado = "Activo" });
        db.ViajesDiarios.AddRange(
            new ViajeDiario { IdViaje = 10, IdUsuario = 1, IdAutobus = 1, FechaInicio = DateTime.UtcNow.AddHours(-2), FechaFin = DateTime.UtcNow.AddHours(-1), EstadoViaje = "Finalizado" },
            new ViajeDiario { IdViaje = 20, IdUsuario = 1, IdAutobus = 1, FechaInicio = DateTime.UtcNow.AddMinutes(-20), EstadoViaje = "En Curso", ModoPrivacidad = true, NavegacionActualizada = DateTime.UtcNow, DestinoNombre = "Destino actual" });
    }

    private static CrearTelemetriaDto Reading(int trip, DateTime time) => new() {
        IdViaje = trip, Latitud = 14.8m, Longitud = -91.5m, VelocidadKmh = 30m, FechaHoraDispositivo = time };

    [Fact]
    public async Task FinishedTripArchive_IsBoundToOriginalTrip_AndCannotResurrectIt()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var service = new TelemetriaService(db);
        var time = DateTime.UtcNow.AddMinutes(-90);
        Assert.Equal(1, await service.RegistrarTelemetriaBatchAsync(1, [Reading(10, time)]));
        Assert.Equal(10, Assert.Single(db.TelemetriaIots).IdViaje);
        Assert.Equal("Finalizado", db.ViajesDiarios.Single(item => item.IdViaje == 10).EstadoViaje);
        var active = db.ViajesDiarios.Single(item => item.IdViaje == 20);
        Assert.True(active.ModoPrivacidad); Assert.Equal("Destino actual", active.DestinoNombre);
        Assert.Equal(0, await service.RegistrarTelemetriaBatchAsync(1, [Reading(10, time)]));
    }

    [Fact]
    public async Task ExplicitArchive_FillsOlderGaps_WithoutDuplicatingTimestamps()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var service = new TelemetriaService(db); var time = DateTime.UtcNow.AddMinutes(-90);
        await service.RegistrarTelemetriaBatchAsync(1, [Reading(10, time)]);
        Assert.Equal(1, await service.RegistrarTelemetriaBatchAsync(1, [Reading(10, time.AddSeconds(-5)), Reading(10, time)]));
        Assert.Equal(2, db.TelemetriaIots.Count());
    }

    [Fact]
    public async Task Archive_RejectsOtherPilotsMixedTripsAndSamplesOutsideJourney()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var service = new TelemetriaService(db); var time = DateTime.UtcNow.AddMinutes(-90);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.RegistrarTelemetriaBatchAsync(2, [Reading(10, time)]));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.RegistrarTelemetriaBatchAsync(1, [Reading(10, time), Reading(20, time)]));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.RegistrarTelemetriaBatchAsync(1, [Reading(10, DateTime.UtcNow)]));
        Assert.Empty(db.TelemetriaIots);
    }

    [Fact]
    public async Task OldArchive_CannotUndoNewerPrivacyOrDestination()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var service = new TelemetriaService(db);
        var reading = Reading(20, DateTime.UtcNow.AddMinutes(-5)); reading.DestinoNombre = "Destino antiguo";
        await service.RegistrarTelemetriaBatchAsync(1, [reading]);
        Assert.True(db.ViajesDiarios.Single(item => item.IdViaje == 20).ModoPrivacidad);
        Assert.Equal("Destino actual", db.ViajesDiarios.Single(item => item.IdViaje == 20).DestinoNombre);
    }

    [Fact]
    public async Task Chat_RetryOfSameOperation_IsAcknowledgedOnce_AndCannotChangeItsContent()
    {
        await using var db = TestDb.Create(); Seed(db); await db.SaveChangesAsync();
        var push = new CountPush();
        var controller = new ChatController(db, push) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "1"), new Claim(ClaimTypes.Name, "Piloto"), new Claim(ClaimTypes.Role, "Piloto")], "Test")) } } };
        var dto = new EnviarMensajeDto { IdCliente = Guid.NewGuid(), IdPilotoCanal = 0, Contenido = "Unidad en ruta" };
        Assert.IsType<OkObjectResult>(await controller.SendMessage(dto, CancellationToken.None));
        Assert.IsType<OkObjectResult>(await controller.SendMessage(dto, CancellationToken.None));
        Assert.Single(db.MensajesChat); Assert.Equal(1, push.RoleCalls);
        dto.Contenido = "Otro mensaje";
        Assert.IsType<ConflictObjectResult>(await controller.SendMessage(dto, CancellationToken.None));
        Assert.Single(db.MensajesChat);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Push_BlockedSenderIsFilteredForRoleAndDirectRecipients(bool roles)
    {
        await using var db = TestDb.Create(); Seed(db);
        for (var id = 2; id <= 3; id++) {
            db.Usuarios.Add(new Usuario { IdUsuario = id, NombreCompleto = "Operador", UsuarioLogin = "operator" + id, Contrasena = "hash", TipoRol = "Administrador", Estado = "Activo" });
            db.DispositivosPush.Add(new DispositivoPush { IdUsuario = id, ExpoPushToken = "ExpoPushToken[device" + id + "]", Plataforma = "ios", Activo = true });
        }
        db.UsuariosChatBloqueados.Add(new UsuarioChatBloqueado { IdUsuario = 2, IdUsuarioBloqueado = 1, FechaBloqueo = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var handler = new PushHandler();
        var service = new ExpoPushNotificationService(db, handler, NullLogger<ExpoPushNotificationService>.Instance);
        var data = new Dictionary<string, string?> { ["senderId"] = "1" };
        if (roles) await service.SendToRolesAsync(["Administrador"], "Mensaje", "Contenido", data);
        else await service.SendToUsersAsync([2, 3], "Mensaje", "Contenido", data);
        await new PushOutboxDispatcher(db, handler, NullLogger<PushOutboxDispatcher>.Instance).ProcessAsync(DateTime.UtcNow);
        Assert.DoesNotContain("device2", handler.Body); Assert.Contains("device3", handler.Body);
    }

    private sealed class PushHandler : HttpMessageHandler, IHttpClientFactory
    {
        public string Body = "";
        public HttpClient CreateClient(string name) => new(this, false) { BaseAddress = new Uri("https://push.invalid/") };
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"data\":[]}") };
        }
    }
    private sealed class CountPush : IPushNotificationService
    {
        public int RoleCalls;
        public Task RegisterDeviceAsync(int userId, string token, string platform, string? deviceId, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task UnregisterDeviceAsync(int userId, string token, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task SendToUsersAsync(IEnumerable<int> userIds, string title, string body, IReadOnlyDictionary<string, string?>? data = null, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task SendToRolesAsync(IEnumerable<string> roles, string title, string body, IReadOnlyDictionary<string, string?>? data = null, int? excludeUserId = null, CancellationToken cancellationToken = default) { RoleCalls++; return Task.CompletedTask; }
    }
}
