using System.Security.Claims;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using webapi.Controllers;
using webapi.Core;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Tests;

public class LogicImplementationTests
{
    static async Task Seed(PrevencionAccidentesBusesContext db)
    {
        db.AddRange(new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", TipoRol = "Piloto", Estado = "Activo", Contrasena = "fixture" },
            new Autobus { IdAutobus = 1, Placa = "FIX-001", Estado = "Activo" },
            new Rutum { IdRuta = 1, NombreRuta = "Original", Origen = "Salida", Destino = "Llegada", DestinoLatitud = 15, DestinoLongitud = -90 });
        db.ViajesDiarios.Add(new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, IdRuta = 1, FechaInicio = DateTime.UtcNow.AddHours(-2), EstadoViaje = "En Curso" });
        await db.SaveChangesAsync();
    }
    static CrearTelemetriaDto Reading(string id, DateTime time, decimal speed = 30) => new() {
        IdViaje = 1, IdLectura = id, FechaHoraDispositivo = time, Latitud = 15.001m, Longitud = -90.001m, VelocidadKmh = speed, PrecisionMetros = 5 };

    [Fact]
    public async Task DispatchReplay_DoesNotCreateAnotherJourney_EvenAfterTheOriginalFinished()
    {
        await using var db = TestDb.Create(); await Seed(db); await new ViajeService(db).FinalizarViajeAsync(1);
        var service = new ViajeService(db); var dto = new CrearViajeDto { IdOperacion = Guid.NewGuid(), IdUsuario = 1, IdAutobus = 1, IdRuta = 1 };
        var created = await service.CrearViajeAsync(dto); await service.FinalizarViajeAsync(created.IdViaje);
        var replay = await service.CrearViajeAsync(dto);
        Assert.Equal(created.IdViaje, replay.IdViaje); Assert.Equal("Finalizado", replay.EstadoViaje); Assert.Equal(2, db.ViajesDiarios.Count());
        dto.IdRuta = null; await Assert.ThrowsAsync<OperationConflictException>(() => service.CrearViajeAsync(dto));
    }

    [Fact]
    public void SqlModelAndPaging_TranslateWithoutOpeningAConnection_AndMigrationsAreEmbedded()
    {
        using var db = new PrevencionAccidentesBusesContext(new DbContextOptionsBuilder<PrevencionAccidentesBusesContext>()
            .UseSqlServer("Server=localhost;Database=eunice_translation_only;Integrated Security=True;Encrypt=False").Options);
        var model = db.Model.FindEntityType(typeof(TelemetriaIot))!;
        Assert.Equal("datetime2(7)", model.FindProperty(nameof(TelemetriaIot.FechaHoraDispositivo))!.GetColumnType());
        Assert.Contains(model.GetIndexes(), x => x.IsUnique && x.GetDatabaseName() == "UX_telemetria_lectura");
        Assert.True(db.Model.FindEntityType(typeof(ViajeDiario))!.FindProperty(nameof(ViajeDiario.Version))!.IsConcurrencyToken);
        var date = DateTime.UtcNow; var id = Guid.NewGuid();
        var query = db.MensajesPasajeros.Where(x => x.FechaHora < date || (x.FechaHora == date && x.IdMensaje.CompareTo(id) < 0)).OrderByDescending(x => x.FechaHora).ThenByDescending(x => x.IdMensaje).Take(200).ToQueryString();
        Assert.Contains("id_mensaje", query);
        Assert.Contains("webapi.Sql.20261016_integridad.sql", typeof(DatabaseSchemaInitializer).Assembly.GetManifestResourceNames());
        Assert.Contains("webapi.Sql.20261016_rls.sql", typeof(DatabaseSchemaInitializer).Assembly.GetManifestResourceNames());
    }

    [Fact]
    public async Task AccountDeletion_AlsoAnonymizesNewHistoricalSnapshots()
    {
        await using var db = TestDb.Create(); await Seed(db);
        db.ViajesDiarios.Single().NombrePilotoSnapshot = "Nombre anterior"; await db.SaveChangesAsync();
        await new UserService(db).EliminarUsuarioAsync(1);
        Assert.Equal("Cuenta eliminada", db.ViajesDiarios.Single().NombrePilotoSnapshot);
        Assert.Equal("Finalizado", db.ViajesDiarios.Single().EstadoViaje);
    }

    [Fact]
    public async Task IdentityReplay_ConfirmsOnlyOneObservation_AndRejectsChangedContent()
    {
        await using var db = TestDb.Create(); await Seed(db); var service = new TelemetriaService(db);
        var time = DateTime.UtcNow.AddMinutes(-5).AddMilliseconds(1);
        Assert.Equal(1, await service.RegistrarTelemetriaAsync(1, Reading("same", time)));
        Assert.Equal(0, await service.RegistrarTelemetriaAsync(1, Reading("same", time)));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.RegistrarTelemetriaAsync(1, Reading("same", time, 40)));
        Assert.Single(db.TelemetriaIots);
        Assert.Equal(time, db.TelemetriaIots.Single().FechaHoraDispositivo);
    }

    [Fact]
    public async Task RoundedLegacyRow_GainsStableIdentity_WithoutDuplicatingHistory()
    {
        await using var db = TestDb.Create(); await Seed(db); var service = new TelemetriaService(db);
        var time = DateTime.UtcNow.AddMinutes(-5); time = new DateTime(time.Ticks - time.Ticks % TimeSpan.TicksPerSecond, DateTimeKind.Utc).AddMilliseconds(1);
        var dto = Reading("recovered", time);
        db.TelemetriaIots.Add(new TelemetriaIot { IdViaje = 1, Latitud = dto.Latitud, Longitud = dto.Longitud, VelocidadKmh = dto.VelocidadKmh,
            FechaHoraDispositivo = new System.Data.SqlTypes.SqlDateTime(time).Value }); await db.SaveChangesAsync();
        Assert.Equal(0, await service.RegistrarTelemetriaAsync(1, dto));
        Assert.Equal(0, await service.RegistrarTelemetriaAsync(1, Reading("recovered", time)));
        Assert.Equal("recovered", Assert.Single(db.TelemetriaIots).IdLectura);
    }

    [Fact]
    public async Task PoisonedArchive_QuarantinesOneReading_AndConfirmsTheOthers()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var dtos = Enumerable.Range(0, 101).Select(i => Reading(i.ToString(), DateTime.UtcNow.AddMinutes(-5).AddSeconds(i))).ToArray();
        dtos[0].FechaHoraDispositivo = DateTime.UtcNow.AddDays(-31);
        var receipts = await new TelemetriaService(db).RegistrarDeliveryAsync(1, dtos);
        Assert.Single(receipts.Lecturas, x => x.Estado == "rechazada");
        Assert.Equal(100, receipts.Lecturas.Count(x => x.Estado == "aceptada"));
        Assert.Equal(100, db.TelemetriaIots.Count());
    }

    [Fact]
    public async Task Episode_IsIndependentOfBatchBoundaries_UsesObservationTime_AndMergesBackfill()
    {
        await using var db = TestDb.Create(); await Seed(db); var service = new TelemetriaService(db);
        var time = DateTime.UtcNow.AddMinutes(-20);
        await service.RegistrarTelemetriaBatchAsync(1, [Reading("a", time, 90), Reading("z", time.AddSeconds(20), 99)]);
        await service.RegistrarTelemetriaBatchAsync(1, Enumerable.Range(1, 19).Select(i => Reading($"b{i}", time.AddSeconds(i), 95)));
        var alert = Assert.Single(db.AlertaRiesgos.Where(x => x.VersionRegla == "episode-v2"));
        Assert.Equal(time, alert.FechaHora); Assert.Equal(time.AddSeconds(20), alert.FechaUltimaObservacion);
        Assert.Equal(99, alert.ValorRegistrado); Assert.True(alert.FechaRecepcion > time);
        Assert.Equal(21, db.TelemetriaIots.Count());
    }

    [Fact]
    public async Task PhoneAxes_WithoutCalibration_DoNotBecomeVehicleManoeuvres()
    {
        await using var db = TestDb.Create(); await Seed(db); var dto = Reading("phone", DateTime.UtcNow);
        dto.AceleracionX = 9; dto.AceleracionY = -9; dto.GiroscopioZ = 9;
        await new TelemetriaService(db).RegistrarTelemetriaAsync(1, dto);
        Assert.Empty(db.AlertaRiesgos);
    }

    [Fact]
    public async Task Finish_IsIdempotent_ClosesAccess_AndKeepsFirstDate()
    {
        await using var db = TestDb.Create(); await Seed(db);
        db.ViajesAccesosPublicos.Add(new ViajeAccesoPublico { IdAcceso = Guid.NewGuid(), IdViaje = 1, TokenHash = "fixture", FechaExpiracion = DateTime.UtcNow.AddDays(2), ChatHabilitado = true }); await db.SaveChangesAsync();
        var service = new ViajeService(db); var first = await service.FinalizarViajeAsync(1); var second = await service.FinalizarViajeAsync(1);
        Assert.Equal(first!.FechaFin, second!.FechaFin); Assert.True(db.ViajesDiarios.Single().ModoPrivacidad);
        Assert.False(db.ViajesAccesosPublicos.Single().ChatHabilitado);
        Assert.True(db.ViajesAccesosPublicos.Single().FechaExpiracion <= first.FechaFin!.Value.AddMinutes(30));
    }

    [Fact]
    public async Task DataOnlyEdits_DoNotChangeAssignment_OrReactivateInactiveUser()
    {
        await using var db = TestDb.Create(); await Seed(db);
        await new AutobusService(db).EditarAutobusAsync(1, new EditarAutobusDto { Placa = "FIX-001", MarcaModelo = "Nuevo modelo", Estado = "Activo" });
        Assert.Equal("En Curso", db.ViajesDiarios.Single().EstadoViaje);
        var pilot = db.Usuarios.Single(); pilot.Estado = "Inactivo"; await db.SaveChangesAsync();
        await new UserService(db).EditarUsuarioAsync(1, new EditarUsuarioDto { NombreCompleto = "Nombre editado", UsuarioLogin = "pilot", TipoRol = "Piloto" });
        Assert.Equal("Inactivo", pilot.Estado);
    }

    [Fact]
    public async Task ChangingRoute_KeepsJourney_AndFrozenHistorySurvivesCatalogueEdits()
    {
        await using var db = TestDb.Create(); await Seed(db);
        db.Ruta.Add(new Rutum { IdRuta = 2, NombreRuta = "Nueva", Origen = "A", Destino = "B", DestinoLatitud = 16, DestinoLongitud = -91 }); await db.SaveChangesAsync();
        await new AutobusService(db).EditarAutobusAsync(1, new EditarAutobusDto { Placa = "FIX-001", Estado = "Activo", GestionarAsignacion = true, IdViajeEsperado = 1, IdPilotoAsignado = 1, IdRutaAsignada = 2 });
        Assert.Single(db.ViajesDiarios); var service = new ViajeService(db); await service.FinalizarViajeAsync(1);
        db.Ruta.Single(x => x.IdRuta == 2).NombreRuta = "Catálogo posterior"; await db.SaveChangesAsync();
        Assert.Equal("Nueva", (await service.GetViajeByIdAsync(1))!.NombreRuta);
    }

    [Fact]
    public async Task MissingCoverage_IsUnrated_NotPerfect_AndOperationalMonthIsGuatemala()
    {
        await using var db = TestDb.Create(); await Seed(db); var service = new EvaluacionService(db);
        var local = DateTime.UtcNow.AddHours(-6);
        await service.ProcesarEvaluacionesMensualesAsync(local.Year, local.Month);
        var rating = Assert.Single(await service.GetEvaluacionesMensualesAsync(local.Year, local.Month));
        Assert.Null(rating.CalificacionDesempeno); Assert.Equal(0, rating.HorasConduccion);
        Assert.Equal(new DateTime(2026, 10, 1, 6, 0, 0, DateTimeKind.Utc), ObservationCoverage.Month(2026, 10).Start);
    }

    [Fact]
    public async Task SourceOwnership_RequiresExplicitTransfer()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var controller = new TrackingSourceController(db) { ControllerContext = Context("Piloto") };
        Assert.IsType<OkObjectResult>(await controller.Acquire(1, new("device-A")));
        Assert.IsType<ConflictObjectResult>(await controller.Acquire(1, new("device-B")));
        Assert.Equal("device-A", db.ViajesDiarios.Single().IdFuenteRastreo);
        Assert.IsType<OkObjectResult>(await controller.Acquire(1, new("device-B", true)));
        await Assert.ThrowsAsync<TrackingSourceConflictException>(() => new TelemetriaService(db).RegistrarTelemetriaAsync(1, Reading("old-device", DateTime.UtcNow)));
    }

    [Fact]
    public async Task PassengerRead_IsExplicitAndBounded_AndPaginationRecoversAllHistory()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var access = new ViajeAccesoPublico { IdAcceso = Guid.NewGuid(), IdViaje = 1, TokenHash = "fixture", FechaExpiracion = DateTime.UtcNow.AddDays(1) };
        var conversation = new ConversacionPasajero { IdConversacion = Guid.NewGuid(), IdAcceso = access.IdAcceso, SesionHash = "fixture", AliasPasajero = "Pasajero" };
        db.AddRange(access, conversation);
        var time = DateTime.UtcNow.AddMinutes(-10);
        for (var i = 0; i < 205; i++) db.MensajesPasajeros.Add(new MensajePasajero { IdMensaje = Guid.NewGuid(), IdConversacion = conversation.IdConversacion,
            NombreEmisor = "Pasajero", TipoEmisor = "Pasajero", Contenido = "Mensaje " + i, FechaHora = time.AddSeconds(i) });
        await db.SaveChangesAsync(); var controller = new PassengerConversationsController(db) { ControllerContext = Context("Administrador") };
        var latest = Assert.IsType<List<MensajePasajeroDto>>(Assert.IsType<OkObjectResult>(await controller.GetMessages(conversation.IdConversacion, default)).Value);
        Assert.Equal(200, latest.Count); Assert.All(db.MensajesPasajeros, x => Assert.Null(x.FechaLectura));
        await controller.Acknowledge(conversation.IdConversacion, new() { IdsMensaje = latest.TakeLast(3).Select(x => x.IdMensaje).ToArray() }, default);
        Assert.Equal(3, db.MensajesPasajeros.Count(x => x.FechaLectura != null));
        var older = Assert.IsType<List<MensajePasajeroDto>>(Assert.IsType<OkObjectResult>(await controller.GetMessages(conversation.IdConversacion, default, latest[0].IdMensaje)).Value);
        Assert.Equal(5, older.Count);
    }

    [Fact]
    public async Task DestinationCommand_IsVersionedSeparatelyFromGps_AndOldSamplesCannotUndoIt()
    {
        await using var db = TestDb.Create(); await Seed(db);
        var source = new TrackingSourceController(db) { ControllerContext = Context("Piloto") };
        Assert.IsType<OkObjectResult>(await source.Acquire(1, new("device-A")));
        var controller = new TripDestinationController(db) { ControllerContext = Context("Piloto") };
        var first = new ConfirmDestinationDto { Lat = 16, Lng = -91, Nombre = "Terminal", Revision = 0 };
        Assert.IsType<OkObjectResult>(await controller.Confirm(1, first));
        Assert.Equal(1, db.ViajesDiarios.Single().RevisionDestino);
        // Replay is harmless even though the first successful command advanced the revision.
        Assert.IsType<OkObjectResult>(await controller.Confirm(1, first));
        Assert.IsType<ConflictObjectResult>(await controller.Confirm(1, new() { Lat = 17, Lng = -92, Nombre = "Viejo", Revision = 0 }));
        var sample = Reading("old-guide", DateTime.UtcNow); sample.IdFuente = "device-A";
        sample.DestinoLat = 14; sample.DestinoLng = -89; sample.DestinoNombre = "Guía anterior";
        await new TelemetriaService(db).RegistrarTelemetriaAsync(1, sample);
        Assert.Equal(16, db.ViajesDiarios.Single().DestinoLatitud);
        Assert.Equal(1, db.ViajesDiarios.Single().RevisionDestino);
        Assert.IsType<OkObjectResult>(await controller.Confirm(1, new() { Lat = 17, Lng = -92, Nombre = "Nuevo", Revision = 1 }));
        Assert.Equal(2, (await new ViajeService(db).GetViajeByIdAsync(1))!.RevisionDestino);
    }

    [Fact]
    public async Task DestinationCommand_DoesNotAllowAnotherPilotToChangeTheJourney()
    {
        await using var db = TestDb.Create(); await Seed(db);
        db.ViajesDiarios.Single().IdUsuario = 2; await db.SaveChangesAsync();
        var controller = new TripDestinationController(db) { ControllerContext = Context("Piloto") };
        Assert.IsType<NotFoundResult>(await controller.Confirm(1, new() { Lat = 16, Lng = -91, Nombre = "No autorizado", Revision = 0 }));
        Assert.Null(db.ViajesDiarios.Single().DestinoNombre);
    }

    static ControllerContext Context(string role) => new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
        new Claim(ClaimTypes.NameIdentifier, "1"), new Claim(ClaimTypes.Role, role)], "fixture")) } };
}
