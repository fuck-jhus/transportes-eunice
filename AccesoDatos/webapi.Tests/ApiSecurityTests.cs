using System.Security.Claims;
using System.Text.Json;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using webapi.Controllers;
using webapi.Services;

namespace webapi.Tests;

public class ApiSecurityTests
{
    [Fact]
    public async Task Login_UsesHttpOnlyCookie_AndDoesNotExposeToken()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario
        {
            IdUsuario = 1,
            NombreCompleto = "Administrador de prueba",
            UsuarioLogin = "admin-test",
            Contrasena = BCrypt.Net.BCrypt.HashPassword("Correct-Horse-123!"),
            TipoRol = "Administrador",
            Estado = "Activo"
        });
        await context.SaveChangesAsync();
        var controller = CreateAuthController(context);

        var response = await controller.Login(new LoginRequestDto
        {
            UsuarioLogin = "admin-test",
            Contrasena = "Correct-Horse-123!"
        });
        var result = Assert.IsType<OkObjectResult>(response);
        var json = JsonSerializer.Serialize(result.Value);
        var cookie = controller.Response.Headers.SetCookie.ToString();

        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InvalidLogin_ReturnsGenericUnauthorizedResponse()
    {
        await using var context = TestDb.Create();
        var controller = CreateAuthController(context);

        var response = await controller.Login(new LoginRequestDto
        {
            UsuarioLogin = "usuario-inexistente",
            Contrasena = "Incorrect-Password!"
        });

        Assert.IsType<UnauthorizedObjectResult>(response);
    }

    [Fact]
    public async Task MobileLogin_ReturnsBearerToken_ForSecureNativeStorage()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario
        {
            IdUsuario = 7,
            NombreCompleto = "Piloto móvil",
            UsuarioLogin = "pilot-mobile",
            Contrasena = BCrypt.Net.BCrypt.HashPassword("Mobile-Password-123!"),
            TipoRol = "Piloto",
            Estado = "Activo"
        });
        await context.SaveChangesAsync();
        var controller = CreateAuthController(context);

        var response = await controller.MobileLogin(new LoginRequestDto
        {
            UsuarioLogin = "pilot-mobile",
            Contrasena = "Mobile-Password-123!"
        });

        var result = Assert.IsType<OkObjectResult>(response);
        var payload = Assert.IsType<MobileLoginResponseDto>(result.Value);
        Assert.Equal(7, payload.Usuario.IdUsuario);
        Assert.Equal("Piloto", payload.Usuario.TipoRol);
        Assert.False(string.IsNullOrWhiteSpace(payload.Token));
        Assert.True(payload.Token.Split('.').Length == 3);
        Assert.Contains("httponly", controller.Response.Headers.SetCookie.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ChatMessage_IsPersisted_UsesTrustedPilotName_AndDeletionIsLogical()
    {
        await using var context = TestDb.Create();
        context.Usuarios.AddRange(
            new Usuario { IdUsuario = 1, NombreCompleto = "Administrador", UsuarioLogin = "admin", Contrasena = "hash", TipoRol = "Administrador", Estado = "Activo" },
            new Usuario { IdUsuario = 2, NombreCompleto = "Piloto real", UsuarioLogin = "pilot", Contrasena = "hash", TipoRol = "Piloto", Estado = "Activo" });
        await context.SaveChangesAsync();
        var controller = CreateChatController(context, 1, "Administrador", "Administrador");

        var sendResult = await controller.SendMessage(new EnviarMensajeDto
        {
            IdPilotoCanal = 2,
            NombrePilotoCanal = "Nombre falsificado",
            Contenido = "Mensaje persistente",
            TipoContenido = "texto"
        }, CancellationToken.None);
        var sent = Assert.IsType<OkObjectResult>(sendResult);
        var item = Assert.IsType<ChatMessageItem>(sent.Value);

        Assert.Equal("Piloto real", item.NombrePilotoCanal);
        Assert.Single(context.MensajesChat);

        var deleteResult = await controller.DeleteMessage(Guid.Parse(item.IdMensaje), CancellationToken.None);
        Assert.IsType<OkObjectResult>(deleteResult);
        var stored = Assert.Single(context.MensajesChat);
        Assert.True(stored.Eliminado);
        Assert.Equal(1, stored.IdEliminadoPor);
    }

    [Fact]
    public async Task Supervisor_CannotSendOperationalChatMessages()
    {
        await using var context = TestDb.Create();
        var controller = CreateChatController(context, 3, "Supervisor", "Supervisor");

        var response = await controller.SendMessage(new EnviarMensajeDto
        {
            IdPilotoCanal = 0,
            Contenido = "Este mensaje no debe persistirse.",
            TipoContenido = "texto"
        }, CancellationToken.None);

        var forbidden = Assert.IsType<ObjectResult>(response);
        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
        Assert.Empty(context.MensajesChat);
    }

    [Fact]
    public async Task AccountOwner_CanDeleteAndAnonymizeOwnAccount()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario
        {
            IdUsuario = 77,
            NombreCompleto = "Cuenta de revisión",
            UsuarioLogin = "review-owner",
            Contrasena = BCrypt.Net.BCrypt.HashPassword("Review-Password-123!"),
            TipoRol = "Piloto",
            Estado = "Activo"
        });
        context.MensajesChat.Add(new MensajeChat
        {
            IdMensaje = Guid.NewGuid(),
            IdEmisor = 77,
            NombreEmisor = "Cuenta de revisión",
            RolEmisor = "Piloto",
            IdPilotoCanal = 0,
            NombrePilotoCanal = "Canal General de la Flota",
            Contenido = "Mensaje que debe retirarse",
            FechaHora = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = CreateAuthController(context);
        controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "77"),
            new Claim(ClaimTypes.Name, "Cuenta de revisión"),
            new Claim(ClaimTypes.Role, "Piloto")
        }, "Test"));

        var response = await controller.DeleteOwnAccount(new EliminarCuentaDto
        {
            Contrasena = "Review-Password-123!"
        });

        Assert.IsType<OkObjectResult>(response);
        var storedUser = Assert.Single(context.Usuarios);
        Assert.Equal("Inactivo", storedUser.Estado);
        Assert.Equal("Cuenta eliminada", storedUser.NombreCompleto);
        var storedMessage = Assert.Single(context.MensajesChat);
        Assert.True(storedMessage.Eliminado);
        Assert.Equal("[Mensaje eliminado por el usuario]", storedMessage.Contenido);
        var users = new UserService(context);
        Assert.Empty(await users.GetUsuariosAsync());
        Assert.Null(await users.GetUsuarioByIdAsync(77));
        Assert.False(await users.CambiarEstadoUsuarioAsync(77, "Activo"));
        Assert.Null(await users.EditarUsuarioAsync(77, new webapi.Dtos.EditarUsuarioDto
        {
            NombreCompleto = "Restaurada", UsuarioLogin = "restored", TipoRol = "Piloto", Estado = "Activo"
        }));
        Assert.Equal("Inactivo", storedUser.Estado);
    }

    [Fact]
    public async Task PreviouslyReactivatedDeletedAccount_CannotLoginOrUseMe()
    {
        await using var context = TestDb.Create();
        context.Usuarios.Add(new Usuario
        {
            IdUsuario = 78, NombreCompleto = "Cuenta eliminada", UsuarioLogin = "deleted_78_0123456789abcdef0123456789abcdef",
            Contrasena = BCrypt.Net.BCrypt.HashPassword("Legacy-Password-123!"),
            TipoRol = "Administrador", Estado = "Activo"
        });
        await context.SaveChangesAsync();
        var controller = CreateAuthController(context);
        var credentials = new LoginRequestDto { UsuarioLogin = "deleted_78_0123456789abcdef0123456789abcdef", Contrasena = "Legacy-Password-123!" };
        Assert.IsType<UnauthorizedObjectResult>(await controller.Login(credentials));
        Assert.IsType<UnauthorizedObjectResult>(await controller.MobileLogin(credentials));
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "78"), new Claim(ClaimTypes.Role, "Administrador")], "Test"));
        Assert.IsType<UnauthorizedObjectResult>(await controller.GetMe());
    }

    private static AuthController CreateAuthController(AccesoDatos.Context.PrevencionAccidentesBusesContext context)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-only-key-that-is-longer-than-thirty-two-characters-123456789",
                ["Jwt:Issuer"] = "https://tests.eunice.local",
                ["Jwt:Audience"] = "https://tests.eunice.local"
            })
            .Build();
        var controller = new AuthController(
            context,
            configuration,
            NullLogger<AuthController>.Instance,
            new TestEnvironment(),
            new UserService(context));
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };
        return controller;
    }

    private static ChatController CreateChatController(
        AccesoDatos.Context.PrevencionAccidentesBusesContext context,
        int userId,
        string name,
        string role)
    {
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Name, name),
            new Claim(ClaimTypes.Role, role)
        }, "Test");
        var controller = new ChatController(context);
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
        };
        return controller;
    }

    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "webapi.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
