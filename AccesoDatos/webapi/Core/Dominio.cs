namespace webapi.Core;

// Valores que se guardan en la base de datos como texto. Escribirlos una sola vez evita que
// un error de tipeo (por ejemplo "En curso") haga que una consulta deje de encontrar datos
// sin que el compilador avise.

/// <summary>Valores de <c>viaje_diario.estado_viaje</c>.</summary>
public static class EstadosViaje
{
    public const string EnCurso = "En Curso";
    public const string Finalizado = "Finalizado";
}

/// <summary>Estado de usuarios y autobuses (<c>usuario.estado</c>, <c>autobus.estado</c>).</summary>
public static class EstadosRegistro
{
    public const string Activo = "Activo";
    public const string Inactivo = "Inactivo";
}

/// <summary>Roles de usuario y combinaciones usadas en <c>[Authorize(Roles = ...)]</c>.</summary>
public static class RolesUsuario
{
    public const string Piloto = "Piloto";
    public const string Administrador = "Administrador";
    public const string Supervisor = "Supervisor";

    /// <summary>
    /// Rol efectivo de la cuenta protegida <see cref="UserAccounts.SuperAdminLogin"/>. No se guarda
    /// en la base de datos: se calcula con <see cref="UserAccounts.EffectiveRole"/>.
    /// </summary>
    public const string SuperAdministrador = "SuperAdministrador";

    public const string Administradores = Administrador + "," + SuperAdministrador;
    public const string Operadores = Administradores + "," + Supervisor;
    public const string PilotosYAdministradores = Piloto + "," + Administradores;
    public const string Todos = Piloto + "," + Operadores;

    public static readonly string[] ListaOperadores = [Administrador, SuperAdministrador, Supervisor];
    public static readonly string[] ListaTodos = [Piloto, Administrador, SuperAdministrador, Supervisor];
}
