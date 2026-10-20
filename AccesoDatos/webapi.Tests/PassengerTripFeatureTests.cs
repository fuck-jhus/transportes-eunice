using System.Security.Claims;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using webapi.Controllers;
using webapi.Core;
using webapi.Dtos;

namespace webapi.Tests;

public sealed class PassengerTripFeatureTests
{
    [Fact]
    public void PublicToken_IsUrlSafeAndOnlyItsHashNeedsToBeStored()
    {
        var token = PublicTripToken.Create();

        Assert.True(PublicTripToken.IsValid(token));
        Assert.Matches("^[A-Za-z0-9_-]+$", token);
        Assert.NotEqual(token, PublicTripToken.Hash(token));
        Assert.Equal(PublicTripToken.Hash(token), PublicTripToken.Hash(token));
    }

    [Fact]
    public void PassengerText_IsTrimmedAndBounded()
    {
        var oversized = $"  {new string('x', 700)}  ";

        Assert.Equal(500, PublicTripToken.NormalizeMessage(oversized).Length);
        Assert.StartsWith("Pasajero ", PublicTripToken.NormalizeAlias("   ", Guid.Parse("11111111-1111-1111-1111-111111111111")));
    }

    [Fact]
    public async Task ExplicitRotation_RevokesThePreviousToken_ButOrdinarySharingReusesIt()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario
        {
            IdUsuario = 7,
            NombreCompleto = "Operador",
            UsuarioLogin = "operador",
            Contrasena = "hash",
            TipoRol = "Administrador",
            Estado = "Activo"
        });
        context.Autobuses.Add(new Autobus { IdAutobus = 4, Placa = "BUS-04", Estado = "Activo" });
        context.ViajesDiarios.Add(new ViajeDiario
        {
            IdViaje = 11,
            IdUsuario = 7,
            IdAutobus = 4,
            FechaInicio = DateTime.UtcNow,
            EstadoViaje = "En Curso"
        });
        await context.SaveChangesAsync();
        var controller = CreateController(context, 7);

        var first = Assert.IsType<OkObjectResult>(await controller.CreateOrRotate(
            11, new CrearAccesoPublicoDto { ChatHabilitado = true }, CancellationToken.None));
        var firstPayload = Assert.IsType<AccesoPublicoViajeDto>(first.Value);
        var reused = Assert.IsType<OkObjectResult>(await controller.CreateOrRotate(11, new CrearAccesoPublicoDto { ChatHabilitado = true }, CancellationToken.None));
        Assert.Equal(firstPayload.Token, Assert.IsType<AccesoPublicoViajeDto>(reused.Value).Token);
        var second = Assert.IsType<OkObjectResult>(await controller.CreateOrRotate(
            11, new CrearAccesoPublicoDto { ChatHabilitado = true, Rotar = true }, CancellationToken.None));
        var secondPayload = Assert.IsType<AccesoPublicoViajeDto>(second.Value);

        Assert.NotNull(firstPayload.Token);
        Assert.NotNull(secondPayload.Token);
        Assert.NotEqual(firstPayload.Token, secondPayload.Token);
        Assert.DoesNotContain(context.ViajesAccesosPublicos, access => access.TokenHash == firstPayload.Token);
        Assert.Single(context.ViajesAccesosPublicos, access => access.FechaRevocacion is null);
        Assert.Single(context.ViajesAccesosPublicos, access => access.FechaRevocacion is not null);
    }

    [Fact]
    public async Task FinishedTrips_CannotCreatePassengerAccess()
    {
        await using var context = TestDb.Create();
        context.ViajesDiarios.Add(new ViajeDiario
        {
            IdViaje = 12,
            IdUsuario = 1,
            IdAutobus = 1,
            FechaInicio = DateTime.UtcNow.AddHours(-1),
            FechaFin = DateTime.UtcNow,
            EstadoViaje = "Finalizado"
        });
        await context.SaveChangesAsync();

        var result = await CreateController(context, 1).CreateOrRotate(
            12, new CrearAccesoPublicoDto(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(context.ViajesAccesosPublicos);
    }

    [Fact]
    public void Supervisor_CanInspectButCannotCreateOrRevokePassengerAccess()
    {
        var classRoles = typeof(TripSharingController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>()
            .Select(attribute => attribute.Roles)
            .ToList();
        var createRoles = typeof(TripSharingController)
            .GetMethod(nameof(TripSharingController.CreateOrRotate))!
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>()
            .Select(attribute => attribute.Roles)
            .ToList();
        var revokeRoles = typeof(TripSharingController)
            .GetMethod(nameof(TripSharingController.Revoke))!
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>()
            .Select(attribute => attribute.Roles)
            .ToList();

        Assert.Contains(classRoles, roles => roles?.Contains("Supervisor", StringComparison.Ordinal) == true);
        Assert.All(createRoles, roles => Assert.DoesNotContain("Supervisor", roles ?? string.Empty, StringComparison.Ordinal));
        Assert.All(revokeRoles, roles => Assert.DoesNotContain("Supervisor", roles ?? string.Empty, StringComparison.Ordinal));
    }

    [Fact]
    public async Task RevokedPassengerConversation_PreservesAuthorizedInternalHistory()
    {
        await using var context = TestDb.Create();
        var user = new Usuario
        {
            IdUsuario = 18,
            NombreCompleto = "Operador",
            UsuarioLogin = "operator-18",
            Contrasena = "hash",
            TipoRol = "Administrador",
            Estado = "Activo"
        };
        var bus = new Autobus { IdAutobus = 18, Placa = "BUS-18", Estado = "Activo" };
        var trip = new ViajeDiario
        {
            IdViaje = 18,
            IdUsuario = user.IdUsuario,
            IdAutobus = bus.IdAutobus,
            FechaInicio = DateTime.UtcNow,
            EstadoViaje = "En Curso"
        };
        var access = new ViajeAccesoPublico
        {
            IdAcceso = Guid.NewGuid(),
            IdViaje = trip.IdViaje,
            TokenHash = "revoked-token-hash",
            FechaCreacion = DateTime.UtcNow.AddMinutes(-5),
            FechaExpiracion = DateTime.UtcNow.AddHours(1),
            FechaRevocacion = DateTime.UtcNow
        };
        var conversation = new ConversacionPasajero
        {
            IdConversacion = Guid.NewGuid(),
            IdAcceso = access.IdAcceso,
            SesionHash = "session-hash",
            AliasPasajero = "Pasajero",
            FechaCreacion = DateTime.UtcNow,
            FechaUltimaActividad = DateTime.UtcNow
        };
        context.AddRange(user, bus, trip, access, conversation);
        await context.SaveChangesAsync();

        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.IdUsuario.ToString()),
            new Claim(ClaimTypes.Role, "Administrador")
        }, "Test");
        var controller = new PassengerConversationsController(context)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };

        var response = await controller.GetMessages(conversation.IdConversacion, CancellationToken.None);

        Assert.IsType<OkObjectResult>(response);
    }

    private static TripSharingController CreateController(AccesoDatos.Context.PrevencionAccidentesBusesContext context, int userId)
    {
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Role, "Administrador")
        }, "Test");
        return new TripSharingController(context)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }
}
