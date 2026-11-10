using System.Security.Claims;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using webapi.Controllers;
using webapi.Core;
using webapi.Dtos;

namespace webapi.Tests;

public sealed class PassengerImprovementsTests
{
    static async Task Seed(PrevencionAccidentesBusesContext db, string tripState = "En Curso")
    {
        db.AddRange(new Usuario { IdUsuario = 1, NombreCompleto = "Piloto Uno", UsuarioLogin = "pilot", TipoRol = "Piloto", Estado = "Activo", Contrasena = "fixture" },
            new Autobus { IdAutobus = 1, Placa = "FIX-001", Estado = "Activo", CodigoPublico = "codigo-fijo-del-bus-123456" },
            new Rutum { IdRuta = 1, NombreRuta = "Xela - Guate", Origen = "Xela", Destino = "Guate", DestinoLatitud = 14.6m, DestinoLongitud = -90.5m });
        db.ViajesDiarios.Add(new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, IdRuta = 1, FechaInicio = DateTime.UtcNow.AddHours(-1), EstadoViaje = tripState });
        await db.SaveChangesAsync();
    }

    static ControllerContext Context(string role, int userId = 1) => new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
        new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, role)], "fixture")) } };

    static async Task<ConversacionPasajero> Conversation(PrevencionAccidentesBusesContext db, params (string Type, DateTime At)[] messages)
    {
        var access = new ViajeAccesoPublico { IdAcceso = Guid.NewGuid(), IdViaje = 1, TokenHash = Guid.NewGuid().ToString("N"), FechaExpiracion = DateTime.UtcNow.AddDays(1), ChatHabilitado = true };
        var conversation = new ConversacionPasajero { IdConversacion = Guid.NewGuid(), IdAcceso = access.IdAcceso, SesionHash = Guid.NewGuid().ToString("N"), AliasPasajero = "Pasajero" };
        db.AddRange(access, conversation);
        foreach (var (type, at) in messages)
            db.MensajesPasajeros.Add(new MensajePasajero { IdMensaje = Guid.NewGuid(), IdConversacion = conversation.IdConversacion,
                TipoEmisor = type, NombreEmisor = type, Contenido = "hola", FechaHora = at });
        await db.SaveChangesAsync();
        return conversation;
    }

    [Fact]
    public async Task BusQr_OpensTheCurrentTrip_AndReusesTheSameLink()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var controller = new PublicBusesController(db);
        var first = Assert.IsType<BusPublicoDto>(Assert.IsType<OkObjectResult>(await controller.Resolve("codigo-fijo-del-bus-123456", default)).Value);
        var second = Assert.IsType<BusPublicoDto>(Assert.IsType<OkObjectResult>(await controller.Resolve("codigo-fijo-del-bus-123456", default)).Value);
        Assert.True(first.ViajeActivo);
        Assert.False(string.IsNullOrEmpty(first.Token));
        Assert.Equal(first.Token, second.Token);
        Assert.Single(db.ViajesAccesosPublicos);
        Assert.True(db.ViajesAccesosPublicos.Single().ChatHabilitado);
        Assert.IsType<NotFoundObjectResult>(await controller.Resolve("codigo-que-no-existe-000000", default));
    }

    [Fact]
    public async Task BusQr_WithoutTripInProgress_SaysSo()
    {
        await using var db = TestDb.Create(); await Seed(db, "Finalizado");
        var result = Assert.IsType<BusPublicoDto>(Assert.IsType<OkObjectResult>(await new PublicBusesController(db).Resolve("codigo-fijo-del-bus-123456", default)).Value);
        Assert.False(result.ViajeActivo);
        Assert.Null(result.Token);
        Assert.Equal("FIX-001", result.Placa);
    }

    [Fact]
    public async Task BusQr_RotateReplacesThePrintedCode()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var controller = new BusQrController(db) { ControllerContext = Context("Administrador") };
        var same = Assert.IsType<CodigoQrAutobusDto>(Assert.IsType<OkObjectResult>(await controller.Get(1, default)).Value);
        Assert.Equal("codigo-fijo-del-bus-123456", same.Codigo);
        var rotated = Assert.IsType<CodigoQrAutobusDto>(Assert.IsType<OkObjectResult>(await controller.Rotate(1, default)).Value);
        Assert.NotEqual(same.Codigo, rotated.Codigo);
        Assert.True(PublicTripToken.IsValid(rotated.Codigo));
    }

    [Fact]
    public async Task PilotOnlySeesConversationsTheControlCenterDerived()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var pending = await Conversation(db, ("Pasajero", DateTime.UtcNow));
        var pilot = new PassengerConversationsController(db) { ControllerContext = Context("Piloto") };
        Assert.Empty(Assert.IsType<List<ConversacionPasajeroDto>>(Assert.IsType<OkObjectResult>(await pilot.GetAll(null, default)).Value));
        Assert.IsType<NotFoundObjectResult>(await pilot.GetMessages(pending.IdConversacion, default));

        var admin = new PassengerConversationsController(db) { ControllerContext = Context("Administrador", 1) };
        Assert.IsType<OkObjectResult>(await admin.DeriveToPilot(pending.IdConversacion, default));
        var visible = Assert.Single(Assert.IsType<List<ConversacionPasajeroDto>>(Assert.IsType<OkObjectResult>(await pilot.GetAll(null, default)).Value));
        Assert.True(visible.DerivadaPiloto);
        Assert.Contains(db.PushOutboxMessages.Local, x => x.EventKey == $"passenger-escalated:{pending.IdConversacion}");
    }

    [Fact]
    public async Task UnansweredPassenger_IsDerivedToThePilotAfterThreeMinutes()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var now = DateTime.UtcNow;
        var waiting = await Conversation(db, ("Pasajero", now.AddMinutes(-4)));
        var recent = await Conversation(db, ("Pasajero", now.AddMinutes(-1)));
        var answered = await Conversation(db, ("Pasajero", now.AddMinutes(-6)), ("Operador", now.AddMinutes(-5)));

        Assert.Equal(1, await PassengerEscalation.ProcessAsync(db, now));
        Assert.NotNull(db.ConversacionesPasajeros.Single(x => x.IdConversacion == waiting.IdConversacion).FechaDerivadaPiloto);
        Assert.Null(db.ConversacionesPasajeros.Single(x => x.IdConversacion == recent.IdConversacion).FechaDerivadaPiloto);
        Assert.Null(db.ConversacionesPasajeros.Single(x => x.IdConversacion == answered.IdConversacion).FechaDerivadaPiloto);
        Assert.Equal(0, await PassengerEscalation.ProcessAsync(db, now));
    }

    [Fact]
    public async Task RouteStops_AreSavedInOrder_AndValidated()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var controller = new RouteStopsController(db) { ControllerContext = Context("Administrador") };
        var saved = Assert.IsType<List<ParadaDto>>(Assert.IsType<OkObjectResult>(await controller.Replace(1, [
            new() { Nombre = " Cuatro Caminos ", Latitud = 14.90m, Longitud = -91.36m },
            new() { Nombre = "Chimaltenango", Latitud = 14.66m, Longitud = -90.82m }], default)).Value);
        Assert.Equal(["Cuatro Caminos", "Chimaltenango"], saved.Select(x => x.Nombre));
        Assert.Equal([1, 2], saved.Select(x => x.Orden));

        var replaced = Assert.IsType<List<ParadaDto>>(Assert.IsType<OkObjectResult>(await controller.Replace(1, [
            new() { Nombre = "Chimaltenango", Latitud = 14.66m, Longitud = -90.82m }], default)).Value);
        Assert.Single(replaced);
        Assert.Single(db.ParadasRuta);
        Assert.IsType<BadRequestObjectResult>(await controller.Replace(1, [new() { Nombre = "x", Latitud = 1, Longitud = 1 }], default));
        Assert.IsType<BadRequestObjectResult>(await controller.Replace(1, Enumerable.Range(0, 26)
            .Select(i => new GuardarParadaDto { Nombre = "Parada " + i, Latitud = 14, Longitud = -90 }).ToList(), default));
    }

    [Fact]
    public async Task RouteStops_KnowWhichOnesTheBusAlreadyPassed()
    {
        await using var db = TestDb.Create(); await Seed(db);
        db.ParadasRuta.AddRange(
            new ParadaRuta { IdParada = 1, IdRuta = 1, Orden = 1, Nombre = "A", Latitud = 14.90m, Longitud = -91.36m },
            new ParadaRuta { IdParada = 2, IdRuta = 1, Orden = 2, Nombre = "B", Latitud = 14.80m, Longitud = -91.10m },
            new ParadaRuta { IdParada = 3, IdRuta = 1, Orden = 3, Nombre = "C", Latitud = 14.66m, Longitud = -90.82m });
        // Pasó cerca de B (sin registrar A): A y B cuentan como pasadas.
        db.TelemetriaIots.Add(new TelemetriaIot { IdViaje = 1, Latitud = 14.8005m, Longitud = -91.1004m, VelocidadKmh = 40, FechaHoraDispositivo = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var stops = await RouteStops.ForTripAsync(db, db.ViajesDiarios.Single(), trackProgress: true, default);
        Assert.Equal([true, true, false], stops.Select(x => x.Passed));
    }

    [Fact]
    public void StopEstimates_UseProviderLegs_OrSplitTheTotal()
    {
        var stops = new List<ParadaRuta> { new() { Nombre = "A", Latitud = 14.5m, Longitud = -90.5m } };
        var waypoints = new List<(decimal, decimal)> { (14.0m, -90.5m), (14.5m, -90.5m), (15.0m, -90.5m) };
        var withLegs = PublicTripsController.StopEstimates(stops, waypoints, [(600m, 10000m), (900m, 15000m)], 1500m, 25000m);
        Assert.Equal(10m, withLegs.Single().Minutos);
        Assert.Equal(10m, withLegs.Single().DistanciaKm);
        var split = PublicTripsController.StopEstimates(stops, waypoints, [], 1200m, 20000m);
        Assert.Equal(10m, split.Single().Minutos);
        Assert.Equal(10m, split.Single().DistanciaKm);
    }
}
