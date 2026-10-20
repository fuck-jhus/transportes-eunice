using AccesoDatos.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using webapi.Controllers;
using webapi.Core;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Tests;

public class OperationsServiceTests
{
    [Fact]
    public void ChatContract_AcceptsLegacyQuickReplyType()
    {
        var dto = new EnviarMensajeDto
        {
            IdPilotoCanal = 0,
            Contenido = "Confirmo recepción.",
            TipoContenido = "rapido"
        };
        var results = new List<ValidationResult>();

        var isValid = Validator.TryValidateObject(dto, new ValidationContext(dto), results, true);

        Assert.True(isValid, string.Join("; ", results.Select(result => result.ErrorMessage)));
    }

    [Fact]
    public async Task ChatLegacyQuickReply_IsNormalizedBeforeDatabaseWrite()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario { IdUsuario = 1, NombreCompleto = "Operador", UsuarioLogin = "operator", Contrasena = "hash", TipoRol = "Administrador", Estado = "Activo" });
        await context.SaveChangesAsync();
        var pushNotifications = new RecordingPushNotificationService();
        var controller = new ChatController(context, pushNotifications)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, "1"),
                        new Claim(ClaimTypes.Name, "Operador"),
                        new Claim(ClaimTypes.Role, "Administrador")
                    }, "Test"))
                }
            }
        };

        var action = await controller.SendMessage(new EnviarMensajeDto
        {
            IdPilotoCanal = 0,
            Contenido = "Confirmo recepción.",
            TipoContenido = "rapido"
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(action);
        Assert.Equal("indicacion", Assert.Single(context.MensajesChat).TipoContenido);
        var push = Assert.Single(pushNotifications.RoleCalls);
        Assert.Contains("Piloto", push.Roles);
        Assert.Equal(1, push.ExcludeUserId);
        Assert.Equal("chat", push.Data?["tab"]);
        Assert.Equal("0", push.Data?["channelId"]);
    }

    [Fact]
    public async Task RouteResponses_DoNotExposeEfNavigationCollections()
    {
        await using var context = TestDb.Create();
        var route = await new RutaService(context).CrearRutaAsync(new CrearRutaDto
        {
            NombreRuta = "Ruta segura",
            Origen = "Xela",
            Destino = "Guatemala"
        });

        var json = JsonSerializer.Serialize(route);
        Assert.DoesNotContain("ViajeDiarios", json);
        Assert.Contains("Ruta segura", json);
    }

    [Fact]
    public void TelemetryContract_RejectsValuesThatOverflowSqlDecimal()
    {
        var dto = new CrearTelemetriaDto
        {
            Latitud = 14.8m,
            Longitud = -91.5m,
            VelocidadKmh = 10m,
            AceleracionX = 1_000m,
            FechaHoraDispositivo = DateTime.UtcNow
        };
        var results = new List<ValidationResult>();

        var isValid = Validator.TryValidateObject(dto, new ValidationContext(dto), results, true);

        Assert.False(isValid);
        Assert.Contains(results, result => result.MemberNames.Contains(nameof(CrearTelemetriaDto.AceleracionX)));
    }

    [Fact]
    public async Task DeactivatingPilot_FinalizesActiveTripAtomically()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" });
        context.Autobuses.Add(new Autobus { IdAutobus = 1, Placa = "BUS-001", Estado = "Activo" });
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();

        var changed = await new UserService(context).CambiarEstadoUsuarioAsync(1, "Inactivo");

        Assert.True(changed);
        Assert.Equal("Inactivo", context.Usuarios.Single().Estado);
        var trip = context.ViajesDiarios.Single();
        Assert.Equal("Finalizado", trip.EstadoViaje);
        Assert.NotNull(trip.FechaFin);
    }

    [Fact]
    public async Task DeletingOperatorWithPassengerAuditTrail_UsesLogicalDeletion()
    {
        await using var context = TestDb.Create();
        var operatorUser = new Usuario { IdUsuario = 41, NombreCompleto = "Operador", UsuarioLogin = "operator-41", Contrasena = "hash", TipoRol = "Administrador", Estado = "Activo" };
        var pilot = new Usuario { IdUsuario = 42, NombreCompleto = "Piloto", UsuarioLogin = "pilot-42", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 41, Placa = "BUS-041", Estado = "Activo" };
        var trip = new ViajeDiario { IdViaje = 41, IdUsuario = pilot.IdUsuario, IdAutobus = bus.IdAutobus, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" };
        var access = new ViajeAccesoPublico
        {
            IdAcceso = Guid.NewGuid(),
            IdViaje = trip.IdViaje,
            TokenHash = "audit-token-hash",
            FechaCreacion = DateTime.UtcNow,
            FechaExpiracion = DateTime.UtcNow.AddHours(1),
            IdCreadoPor = operatorUser.IdUsuario
        };
        context.AddRange(operatorUser, pilot, bus, trip, access);
        await context.SaveChangesAsync();

        var removed = await new UserService(context).EliminarUsuarioAsync(operatorUser.IdUsuario);

        Assert.True(removed);
        var stored = Assert.Single(context.Usuarios, item => item.IdUsuario == operatorUser.IdUsuario);
        Assert.Equal("Inactivo", stored.Estado);
        Assert.Equal("Cuenta eliminada", stored.NombreCompleto);
        Assert.StartsWith("deleted_41_", stored.UsuarioLogin);
        Assert.Null(Assert.Single(context.ViajesAccesosPublicos).IdCreadoPor);
    }

    [Fact]
    public async Task CreatingTrip_AllowsOptionalRoute()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" });
        context.Autobuses.Add(new Autobus { IdAutobus = 1, Placa = "BUS-001", Estado = "Activo" });
        await context.SaveChangesAsync();

        var result = await new ViajeService(context).CrearViajeAsync(new CrearViajeDto
        {
            IdUsuario = 1,
            IdAutobus = 1,
            IdRuta = null
        });

        Assert.Null(result.IdRuta);
        Assert.Equal("Sin ruta asignada", result.NombreRuta);
        Assert.Single(context.ViajesDiarios);
    }

    [Fact]
    public async Task CreatingBusWithPilot_IsSingleConsistentOperation()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" });
        await context.SaveChangesAsync();

        var bus = await new AutobusService(context).CrearAutobusAsync(new CrearAutobusDto
        {
            Placa = " p-1324 ",
            MarcaModelo = "Mercedes",
            Estado = "Activo",
            IdPilotoAsignado = 1,
            IdRutaAsignada = null
        });

        Assert.Equal("P-1324", bus.Placa);
        var trip = Assert.Single(context.ViajesDiarios);
        Assert.Equal(bus.IdAutobus, trip.IdAutobus);
        Assert.Equal(1, trip.IdUsuario);
        Assert.Null(trip.IdRuta);
        Assert.Equal("En Curso", trip.EstadoViaje);
        var apiJson = JsonSerializer.Serialize(bus);
        Assert.DoesNotContain("ViajeDiarios", apiJson);
        Assert.Contains("P-1324", apiJson);
    }

    [Fact]
    public async Task CreatingBusWithInvalidAssignment_DoesNotPersistPartialBus()
    {
        await using var context = TestDb.Create();
        var service = new AutobusService(context);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CrearAutobusAsync(new CrearAutobusDto
        {
            Placa = "BUS-INVALID",
            Estado = "Activo",
            IdPilotoAsignado = 999
        }));

        Assert.Empty(context.Autobuses);
        Assert.Empty(context.ViajesDiarios);
    }

    [Fact]
    public async Task EditingBusAssignment_ReplacesActiveTripWithoutDuplicates()
    {
        await using var context = TestDb.Create();
        context.Usuarios.AddRange(
            new Usuario { IdUsuario = 1, NombreCompleto = "Piloto Uno", UsuarioLogin = "pilot1", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" },
            new Usuario { IdUsuario = 2, NombreCompleto = "Piloto Dos", UsuarioLogin = "pilot2", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" });
        context.Autobuses.Add(new Autobus { IdAutobus = 1, Placa = "BUS-001", Estado = "Activo" });
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();

        await new AutobusService(context).EditarAutobusAsync(1, new EditarAutobusDto
        {
            Placa = "BUS-001",
            Estado = "Activo",
            GestionarAsignacion = true,
            IdViajeEsperado = 1,
            IdPilotoAsignado = 2
        });

        var trips = context.ViajesDiarios.OrderBy(item => item.IdViaje).ToList();
        Assert.Equal(2, trips.Count);
        Assert.Equal("Finalizado", trips[0].EstadoViaje);
        Assert.Equal(2, trips[1].IdUsuario);
        Assert.Equal("En Curso", trips[1].EstadoViaje);
    }

    [Fact]
    public async Task CreatingTrip_PreventsSecondActiveTripForPilot()
    {
        await using var context = TestDb.Create();
        var pilot = new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var firstBus = new Autobus { IdAutobus = 1, Placa = "BUS-001", Estado = "Activo" };
        var secondBus = new Autobus { IdAutobus = 2, Placa = "BUS-002", Estado = "Activo" };
        var route = new Rutum { IdRuta = 1, NombreRuta = "Xela", Origen = "Guatemala", Destino = "Xela" };
        context.AddRange(pilot, firstBus, secondBus, route);
        await context.SaveChangesAsync();
        var service = new ViajeService(context);

        await service.CrearViajeAsync(new CrearViajeDto { IdUsuario = 1, IdAutobus = 1, IdRuta = 1 });
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CrearViajeAsync(new CrearViajeDto { IdUsuario = 1, IdAutobus = 2, IdRuta = 1 }));

        Assert.Contains("ya tiene un viaje en curso", error.Message);
    }

    [Fact]
    public async Task PilotTripQuery_ReturnsOnlyOwnTrips()
    {
        await using var context = TestDb.Create();
        var pilotOne = new Usuario { IdUsuario = 1, NombreCompleto = "Uno", UsuarioLogin = "uno", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var pilotTwo = new Usuario { IdUsuario = 2, NombreCompleto = "Dos", UsuarioLogin = "dos", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var busOne = new Autobus { IdAutobus = 1, Placa = "BUS-001", Estado = "Activo" };
        var busTwo = new Autobus { IdAutobus = 2, Placa = "BUS-002", Estado = "Activo" };
        var route = new Rutum { IdRuta = 1, NombreRuta = "Ruta", Origen = "A", Destino = "B" };
        context.AddRange(pilotOne, pilotTwo, busOne, busTwo, route);
        context.ViajesDiarios.AddRange(
            new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, IdRuta = 1, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" },
            new ViajeDiario { IdViaje = 2, IdUsuario = 2, IdAutobus = 2, IdRuta = 1, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();

        var result = (await new ViajeService(context).GetViajesAsync(idUsuario: 1)).ToList();

        Assert.Single(result);
        Assert.Equal(1, result[0].IdUsuario);
    }

    [Fact]
    public async Task TelemetryReading_CreatesAllSimultaneousRiskAlerts()
    {
        await using var context = TestDb.Create();
        var pilot = new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 1, Placa = "BUS-001", Estado = "Activo" };
        var route = new Rutum { IdRuta = 1, NombreRuta = "Ruta", Origen = "A", Destino = "B" };
        context.AddRange(pilot, bus, route);
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, IdRuta = 1, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();

        await new TelemetriaService(context).RegistrarTelemetriaAsync(1, new CrearTelemetriaDto
        {
            Latitud = 14.8347m,
            Longitud = -91.5181m,
            VelocidadKmh = 95m,
            AceleracionY = -4m,
            SensoresCalibrados = true,
            AceleracionX = 4m,
            FechaHoraDispositivo = DateTime.UtcNow
        });

        var alertTypes = context.AlertaRiesgos.Select(alert => alert.TipoAlerta).ToList();
        Assert.Equal(3, alertTypes.Count);
        Assert.Contains("Exceso de Velocidad", alertTypes);
        Assert.Contains("Frenado Brusco", alertTypes);
        Assert.Contains("Giro Brusco", alertTypes);
    }

    [Fact]
    public async Task TelemetryReading_IgnoresDuplicateAndOutOfOrderPositions()
    {
        await using var context = TestDb.Create();
        var pilot = new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 1, Placa = "BUS-001", Estado = "Activo" };
        var route = new Rutum { IdRuta = 1, NombreRuta = "Ruta", Origen = "A", Destino = "B" };
        context.AddRange(pilot, bus, route);
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, IdRuta = 1, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();

        var service = new TelemetriaService(context);
        var timestamp = DateTime.UtcNow.AddSeconds(-5);
        var first = await service.RegistrarTelemetriaAsync(1, new CrearTelemetriaDto
        {
            Latitud = 14.8347m,
            Longitud = -91.5181m,
            VelocidadKmh = 30m,
            FechaHoraDispositivo = timestamp
        });
        var duplicate = await service.RegistrarTelemetriaAsync(1, new CrearTelemetriaDto
        {
            Latitud = 14.84m,
            Longitud = -91.52m,
            VelocidadKmh = 40m,
            FechaHoraDispositivo = timestamp
        });
        var older = await service.RegistrarTelemetriaAsync(1, new CrearTelemetriaDto
        {
            Latitud = 14.80m,
            Longitud = -91.50m,
            VelocidadKmh = 20m,
            FechaHoraDispositivo = timestamp.AddSeconds(-1)
        });

        Assert.Equal(1, first);
        Assert.Equal(0, duplicate);
        Assert.Equal(0, older);
        Assert.Single(context.TelemetriaIots);
        Assert.Equal(14.8347m, context.TelemetriaIots.Single().Latitud);
    }

    [Fact]
    public async Task TelemetryReading_PublishesPilotDestinationForLiveDispatch()
    {
        await using var context = TestDb.Create();
        const int pilotId = 101;
        const string plate = "BUS-DST-101";
        var pilot = new Usuario { IdUsuario = pilotId, NombreCompleto = "Piloto destino", UsuarioLogin = "pilot-dst", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 101, Placa = plate, Estado = "Activo" };
        var route = new Rutum { IdRuta = 101, NombreRuta = "Ruta destino", Origen = "A", Destino = "B" };
        context.AddRange(pilot, bus, route);
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 101, IdUsuario = pilotId, IdAutobus = 101, IdRuta = 101, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();

        await new TelemetriaService(context).RegistrarTelemetriaAsync(pilotId, new CrearTelemetriaDto
        {
            Latitud = 14.8347m,
            Longitud = -91.5181m,
            VelocidadKmh = 42m,
            Heading = 270m,
            DestinoLat = 14.65m,
            DestinoLng = -90.52m,
            DestinoNombre = "  Ciudad de Guatemala  ",
            FechaHoraDispositivo = DateTime.UtcNow
        });

        var live = Assert.Single(WebSocketConnectionManager.GetActiveTelemetry(), item => item.PlacaAutobus == plate);
        Assert.True(live.IsTripActive);
        Assert.Equal(270m, live.Heading);
        Assert.Equal(14.65m, live.DestinoLat);
        Assert.Equal(-90.52m, live.DestinoLng);
        Assert.Equal("Ciudad de Guatemala", live.DestinoNombre);
    }

    [Fact]
    public async Task PrivacyMode_HidesCoordinatesWithoutPersistingFakeTelemetry()
    {
        await using var context = TestDb.Create();
        const int pilotId = 102;
        const string plate = "BUS-PRV-102";
        var pilot = new Usuario { IdUsuario = pilotId, NombreCompleto = "Piloto privacidad", UsuarioLogin = "pilot-prv", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 102, Placa = plate, Estado = "Activo" };
        var route = new Rutum { IdRuta = 102, NombreRuta = "Ruta privacidad", Origen = "A", Destino = "B" };
        context.AddRange(pilot, bus, route);
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 102, IdUsuario = pilotId, IdAutobus = 102, IdRuta = 102, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();
        var service = new TelemetriaService(context);
        await service.RegistrarTelemetriaAsync(pilotId, new CrearTelemetriaDto
        {
            Latitud = 14.8347m,
            Longitud = -91.5181m,
            VelocidadKmh = 25m,
            FechaHoraDispositivo = DateTime.UtcNow
        });

        await service.ActualizarEstadoPilotoAsync(pilotId, true);

        Assert.Single(context.TelemetriaIots);
        var hidden = Assert.Single(WebSocketConnectionManager.GetActiveTelemetry(), item => item.PlacaAutobus == plate);
        Assert.True(hidden.IsPrivacyMode);
        Assert.Equal(0, hidden.Latitud);
        Assert.Equal(0, hidden.Longitud);

        await service.ActualizarEstadoPilotoAsync(pilotId, false);
        var resumed = Assert.Single(WebSocketConnectionManager.GetActiveTelemetry(), item => item.PlacaAutobus == plate);
        Assert.False(resumed.IsPrivacyMode);
        Assert.Equal(14.8347m, resumed.Latitud);
        Assert.Equal(-91.5181m, resumed.Longitud);
    }

    [Fact]
    public async Task FinalizingTrip_RemovesBusFromActiveLiveTracking()
    {
        await using var context = TestDb.Create();
        const int pilotId = 103;
        const string plate = "BUS-END-103";
        var pilot = new Usuario { IdUsuario = pilotId, NombreCompleto = "Piloto final", UsuarioLogin = "pilot-end", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 103, Placa = plate, Estado = "Activo" };
        var route = new Rutum { IdRuta = 103, NombreRuta = "Ruta final", Origen = "A", Destino = "B" };
        context.AddRange(pilot, bus, route);
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 103, IdUsuario = pilotId, IdAutobus = 103, IdRuta = 103, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();
        await new TelemetriaService(context).RegistrarTelemetriaAsync(pilotId, new CrearTelemetriaDto
        {
            Latitud = 14.8347m,
            Longitud = -91.5181m,
            VelocidadKmh = 10m,
            FechaHoraDispositivo = DateTime.UtcNow
        });
        Assert.Contains(WebSocketConnectionManager.GetActiveTelemetry(), item => item.PlacaAutobus == plate);

        await new ViajeService(context).FinalizarViajeAsync(103);

        Assert.DoesNotContain(WebSocketConnectionManager.GetActiveTelemetry(), item => item.PlacaAutobus == plate);
    }

    [Fact]
    public async Task PilotCannotFinalizeAnotherPilotsTrip()
    {
        await using var context = TestDb.Create();
        var owner = new Usuario { IdUsuario = 201, NombreCompleto = "Propietario", UsuarioLogin = "owner", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var other = new Usuario { IdUsuario = 202, NombreCompleto = "Otro piloto", UsuarioLogin = "other", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 201, Placa = "BUS-OWN-201", Estado = "Activo" };
        context.AddRange(owner, other, bus);
        context.ViajesDiarios.Add(new ViajeDiario
        {
            IdViaje = 201,
            IdUsuario = owner.IdUsuario,
            IdAutobus = bus.IdAutobus,
            FechaInicio = DateTime.UtcNow,
            EstadoViaje = "En Curso"
        });
        await context.SaveChangesAsync();

        var service = new ViajeService(context);
        var denied = await service.FinalizarViajeAsync(201, other.IdUsuario);

        Assert.Null(denied);
        Assert.Equal("En Curso", (await context.ViajesDiarios.FindAsync(201))!.EstadoViaje);

        var finalized = await service.FinalizarViajeAsync(201, owner.IdUsuario);
        Assert.NotNull(finalized);
        Assert.Equal("Finalizado", finalized!.EstadoViaje);
    }

    [Fact]
    public async Task PilotCanSaveRouteAndAssociateItWithOwnActiveTrip()
    {
        await using var context = TestDb.Create();
        var pilot = new Usuario { IdUsuario = 301, NombreCompleto = "Piloto ruta", UsuarioLogin = "route-pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 301, Placa = "BUS-ROUTE-301", Estado = "Activo" };
        context.AddRange(pilot, bus);
        context.ViajesDiarios.Add(new ViajeDiario
        {
            IdViaje = 301,
            IdUsuario = pilot.IdUsuario,
            IdAutobus = bus.IdAutobus,
            FechaInicio = DateTime.UtcNow,
            EstadoViaje = "En Curso"
        });
        await context.SaveChangesAsync();

        var saved = await new ViajeService(context).GuardarRutaEnViajeAsync(301, new GuardarRutaViajeDto
        {
            NombreRuta = "Terminal a Centro",
            Origen = "Terminal Minerva",
            Destino = "Parque Central",
            OrigenLatitud = 14.8430m,
            OrigenLongitud = -91.5350m,
            DestinoLatitud = 14.8347m,
            DestinoLongitud = -91.5181m
        }, pilot.IdUsuario);

        Assert.NotNull(saved);
        Assert.Equal("Terminal a Centro", saved!.NombreRuta);
        var route = Assert.Single(context.Ruta);
        var trip = Assert.Single(context.ViajesDiarios);
        Assert.Equal(route.IdRuta, trip.IdRuta);
        Assert.Equal("Parque Central", trip.DestinoNombre);
        Assert.Equal(14.8347m, route.DestinoLatitud);
    }

    [Fact]
    public async Task PilotCannotSaveRouteForAnotherPilotsTrip()
    {
        await using var context = TestDb.Create();
        var owner = new Usuario { IdUsuario = 311, NombreCompleto = "Propietario", UsuarioLogin = "route-owner", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var other = new Usuario { IdUsuario = 312, NombreCompleto = "Otro", UsuarioLogin = "route-other", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 311, Placa = "BUS-ROUTE-311", Estado = "Activo" };
        context.AddRange(owner, other, bus);
        context.ViajesDiarios.Add(new ViajeDiario
        {
            IdViaje = 311,
            IdUsuario = owner.IdUsuario,
            IdAutobus = bus.IdAutobus,
            FechaInicio = DateTime.UtcNow,
            EstadoViaje = "En Curso"
        });
        await context.SaveChangesAsync();

        var denied = await new ViajeService(context).GuardarRutaEnViajeAsync(311, new GuardarRutaViajeDto
        {
            NombreRuta = "Ruta ajena",
            Origen = "A",
            Destino = "B",
            DestinoLatitud = 14.8m,
            DestinoLongitud = -91.5m
        }, other.IdUsuario);

        Assert.Null(denied);
        Assert.Empty(context.Ruta);
        Assert.Null(Assert.Single(context.ViajesDiarios).IdRuta);
    }

    [Fact]
    public async Task SavingExistingManualRouteBackfillsGpsCoordinatesWithoutDuplicatingIt()
    {
        await using var context = TestDb.Create();
        var pilot = new Usuario { IdUsuario = 321, NombreCompleto = "Piloto", UsuarioLogin = "route-backfill", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { IdAutobus = 321, Placa = "BUS-ROUTE-321", Estado = "Activo" };
        var route = new Rutum { IdRuta = 321, NombreRuta = "Ruta existente", Origen = "A", Destino = "B" };
        context.AddRange(pilot, bus, route);
        context.ViajesDiarios.Add(new ViajeDiario { IdViaje = 321, IdUsuario = pilot.IdUsuario, IdAutobus = bus.IdAutobus, FechaInicio = DateTime.UtcNow, EstadoViaje = "En Curso" });
        await context.SaveChangesAsync();

        await new ViajeService(context).GuardarRutaEnViajeAsync(321, new GuardarRutaViajeDto
        {
            NombreRuta = "Ruta existente",
            Origen = "A",
            Destino = "B",
            DestinoLatitud = 14.80m,
            DestinoLongitud = -91.50m
        }, pilot.IdUsuario);

        Assert.Single(context.Ruta);
        Assert.Equal(14.80m, context.Ruta.Single().DestinoLatitud);
        Assert.Equal(route.IdRuta, context.ViajesDiarios.Single().IdRuta);
    }

    private sealed class RecordingPushNotificationService : IPushNotificationService
    {
        public List<(int[] UserIds, string Title, string Body, IReadOnlyDictionary<string, string?>? Data)> UserCalls { get; } = [];
        public List<(string[] Roles, string Title, string Body, IReadOnlyDictionary<string, string?>? Data, int? ExcludeUserId)> RoleCalls { get; } = [];

        public Task RegisterDeviceAsync(int userId, string expoPushToken, string platform, string? deviceId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task UnregisterDeviceAsync(int userId, string expoPushToken, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task SendToUsersAsync(IEnumerable<int> userIds, string title, string body, IReadOnlyDictionary<string, string?>? data = null, CancellationToken cancellationToken = default)
        {
            UserCalls.Add((userIds.ToArray(), title, body, data));
            return Task.CompletedTask;
        }

        public Task SendToRolesAsync(IEnumerable<string> roles, string title, string body, IReadOnlyDictionary<string, string?>? data = null, int? excludeUserId = null, CancellationToken cancellationToken = default)
        {
            RoleCalls.Add((roles.ToArray(), title, body, data, excludeUserId));
            return Task.CompletedTask;
        }
    }
}
