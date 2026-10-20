using System.Data.Common;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace webapi.Core;

// RLS trusts the API's authenticated principal, not a client-supplied SQL role.
// Set every key on EVERY open, including pooled connections and anonymous calls.
public sealed class DatabaseSessionContextInterceptor(IHttpContextAccessor accessor) : DbConnectionInterceptor
{
    private DbCommand Command(DbConnection connection)
    {
        var http = accessor.HttpContext;
        var role = http == null ? "System" : http.User.Identity?.IsAuthenticated == true ? http.User.FindFirstValue(ClaimTypes.Role) ?? "Anonymous" : "Anonymous";
        var userId = http?.User.Identity?.IsAuthenticated == true && int.TryParse(http.User.FindFirstValue(ClaimTypes.NameIdentifier), out var parsed) ? parsed : (int?)null;
        string? tokenHash = null, guestHash = null;
        var parts = http?.Request.Path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts is { Length: >= 4 } && parts[0] == "api" && parts[1] == "public" && parts[2] == "viajes" && PublicTripToken.IsValid(parts[3]))
        {
            tokenHash = PublicTripToken.Hash(parts[3]);
            if (http!.Request.Cookies.TryGetValue(PublicTripToken.GuestCookieName, out var guest) && PublicTripToken.IsValid(guest)) guestHash = PublicTripToken.Hash(guest);
        }
        var command = connection.CreateCommand();
        command.CommandTimeout = 10;
        command.CommandText = "EXEC sys.sp_set_session_context @key=N'eunice_user',@value=@user; EXEC sys.sp_set_session_context @key=N'eunice_role',@value=@role; EXEC sys.sp_set_session_context @key=N'eunice_public',@value=@public; EXEC sys.sp_set_session_context @key=N'eunice_guest',@value=@guest;";
        void Add(string name, object? value) { var parameter = command.CreateParameter(); parameter.ParameterName = name; parameter.Value = value ?? DBNull.Value; command.Parameters.Add(parameter); }
        Add("@user", userId); Add("@role", role); Add("@public", tokenHash); Add("@guest", guestHash);
        return command;
    }
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    { using var command = Command(connection); command.ExecuteNonQuery(); }
    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    { await using var command = Command(connection); await command.ExecuteNonQueryAsync(cancellationToken); }
}
