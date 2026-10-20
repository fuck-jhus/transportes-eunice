using AccesoDatos.Models;

namespace webapi.Core;

public static class UserAccounts
{
    // Deletion already replaces the login with deleted_<id>_<random>. Reserve
    // that namespace and recognize existing deletions without a schema change.
    public const string DeletedLoginPrefix = "deleted_";

    // Match the account ID and generated length as well, so an older ordinary
    // login that merely resembles the prefix does not disappear.
    public static IQueryable<Usuario> WithoutDeletedAccounts(this IQueryable<Usuario> users) =>
        users.Where(user => !(user.UsuarioLogin.ToLower().StartsWith(DeletedLoginPrefix + user.IdUsuario + "_")
            && user.UsuarioLogin.Length == (user.IdUsuario >= 1000000000 ? 50 : 41 + user.IdUsuario.ToString().Length)));

    public static bool IsDeletedLogin(string login) =>
        login.StartsWith(DeletedLoginPrefix, StringComparison.OrdinalIgnoreCase);
}
