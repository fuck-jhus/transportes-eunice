using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using AccesoDatos.Models;
using webapi.Core;
using webapi.Dtos;
using webapi.Services;

namespace webapi.Tests;

public class DeletedAccountsTests
{
    private static Usuario User(int id, string login, string state = "Activo") => new()
    {
        IdUsuario = id, UsuarioLogin = login, NombreCompleto = "Personal",
        TipoRol = "Piloto", Estado = state, Contrasena = "fixture"
    };

    [Fact]
    public async Task LegacyDeletedAccount_IsHiddenEvenIfItsNameAndStatusWereEdited()
    {
        await using var db = TestDb.Create();
        const string deletedLogin = "DELETED_91_0123456789abcdef0123456789abcdef";
        var deleted = User(91, deletedLogin);
        deleted.NombreCompleto = "Nombre editado despues de la baja";
        db.Add(deleted);
        await db.SaveChangesAsync();
        var users = new UserService(db);
        Assert.Empty(await users.GetUsuariosAsync());
        Assert.Null(await users.GetUsuarioByIdAsync(91));
        Assert.False(await users.CambiarEstadoUsuarioAsync(91, "Activo"));
        Assert.Null(await users.EditarUsuarioAsync(91, new EditarUsuarioDto
        {
            NombreCompleto = "Nueva cuenta", UsuarioLogin = "new-user", TipoRol = "Piloto", Estado = "Activo"
        }));
        Assert.False(await users.EliminarUsuarioAsync(91));
        Assert.Equal(deletedLogin, Assert.Single(db.Usuarios).UsuarioLogin);
    }

    [Theory]
    [InlineData("deletedXregular")]
    [InlineData("deleted_92_ordinary")]
    [InlineData("deleted_999_0123456789abcdef0123456789abcdef")]
    public async Task SuspendedAccount_RemainsVisibleAndCanBeReactivated(string login)
    {
        await using var db = TestDb.Create();
        var suspended = User(92, login, "Inactivo");
        suspended.NombreCompleto = "Cuenta eliminada";
        db.Add(suspended);
        await db.SaveChangesAsync();
        var users = new UserService(db);
        Assert.Equal(92, Assert.Single(await users.GetUsuariosAsync()).IdUsuario);
        Assert.NotNull(await users.GetUsuarioByIdAsync(92));
        Assert.True(await users.CambiarEstadoUsuarioAsync(92, "Activo"));
        Assert.Equal("Activo", suspended.Estado);
        Assert.NotNull(await users.EditarUsuarioAsync(92, new EditarUsuarioDto
        {
            NombreCompleto = "Personal actualizado", UsuarioLogin = login, TipoRol = "Piloto", Estado = "Activo"
        }));
        Assert.Equal("Personal actualizado", suspended.NombreCompleto);
    }

    [Theory]
    [InlineData("deleted_93_manual")]
    [InlineData("DELETED_93_manual")]
    [InlineData(" deleted_93_manual ")]
    public async Task ReservedDeletionLogin_CannotBeCreatedOrAssignedToAnExistingAccount(string login)
    {
        await using var db = TestDb.Create();
        db.Add(User(93, "regular-93"));
        await db.SaveChangesAsync();
        var users = new UserService(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() => users.CrearUsuarioAsync(new CrearUsuarioDto
        {
            NombreCompleto = "Personal", UsuarioLogin = login, TipoRol = "Piloto", Contrasena = "Test-Password-123!"
        }));
        await Assert.ThrowsAsync<InvalidOperationException>(() => users.EditarUsuarioAsync(93, new EditarUsuarioDto
        {
            NombreCompleto = "Personal", UsuarioLogin = login, TipoRol = "Piloto", Estado = "Activo"
        }));
        Assert.Equal("regular-93", Assert.Single(db.Usuarios).UsuarioLogin);
    }

    [Fact]
    public async Task Deletion_ClosesOwnSocketAndNotifiesOnlyUserReaders()
    {
        const int deletedId = 9700001;
        await using var db = TestDb.Create();
        db.Add(User(deletedId, "delete-socket"));
        await db.SaveChangesAsync();
        var sockets = new[] { new RecordingSocket(), new RecordingSocket(), new RecordingSocket(), new RecordingSocket(), new RecordingSocket() };
        var roles = new[] { "Administrador", "Administrador", "SuperAdministrador", "Supervisor", "Piloto" };
        try
        {
            for (var i = 0; i < sockets.Length; i++)
                WebSocketConnectionManager.AddSocket(sockets[i], deletedId + i, "Test", roles[i]);
            Assert.True(await new UserService(db).EliminarUsuarioAsync(deletedId));
            Assert.Equal(WebSocketState.Aborted, sockets[0].State);
            Assert.Empty(db.Usuarios);
            for (var i = 0; i < sockets.Length; i++)
            {
                var removal = sockets[i].Frames.Where(frame =>
                {
                    using var json = JsonDocument.Parse(frame);
                    return json.RootElement.TryGetProperty("tipoMensaje", out var type)
                        && type.GetString() == "usuario_eliminado"
                        && json.RootElement.GetProperty("data").GetProperty("idUsuario").GetInt32() == deletedId;
                });
                if (i is 1 or 2 or 3) Assert.Single(removal);
                else Assert.Empty(removal);
            }
        }
        finally
        {
            foreach (var socket in sockets)
            {
                WebSocketConnectionManager.RemoveSocket(socket);
                socket.Dispose();
            }
        }
    }

    private sealed class RecordingSocket : WebSocket
    {
        private WebSocketState _state = WebSocketState.Open;
        public ConcurrentQueue<string> Frames { get; } = new();
        public override WebSocketCloseStatus? CloseStatus => null;
        public override string? CloseStatusDescription => null;
        public override WebSocketState State => _state;
        public override string? SubProtocol => null;
        public override void Abort() => _state = WebSocketState.Aborted;
        public override void Dispose() => _state = WebSocketState.Closed;
        public override Task CloseAsync(WebSocketCloseStatus status, string? description, CancellationToken token)
        { _state = WebSocketState.Closed; return Task.CompletedTask; }
        public override Task CloseOutputAsync(WebSocketCloseStatus status, string? description, CancellationToken token)
        { _state = WebSocketState.CloseSent; return Task.CompletedTask; }
        public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken token) => throw new NotSupportedException();
        public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType type, bool endOfMessage, CancellationToken token)
        { Frames.Enqueue(Encoding.UTF8.GetString(buffer.AsSpan())); return Task.CompletedTask; }
    }
}
