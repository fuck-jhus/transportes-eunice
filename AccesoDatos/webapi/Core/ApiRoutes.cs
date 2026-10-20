namespace webapi.Core;

/// <summary>
/// Canonical route prefixes exposed by the HTTP API.
/// Keeping these values explicit prevents controller renames or reverse-proxy
/// path rewriting from creating accidental aliases outside /api.
/// </summary>
public static class ApiRoutes
{
    public const string Prefix = "api";

    public const string Alertas = Prefix + "/alertas";
    public const string Auth = Prefix + "/auth";
    public const string Autobuses = Prefix + "/autobuses";
    public const string Chat = Prefix + "/chat";
    public const string Evaluaciones = Prefix + "/evaluaciones";
    public const string Mapas = Prefix + "/mapas";
    public const string Notificaciones = Prefix + "/notificaciones";
    public const string Rutas = Prefix + "/rutas";
    public const string Telemetria = Prefix + "/telemetria";
    public const string Usuarios = Prefix + "/usuarios";
    public const string Viajes = Prefix + "/viajes";
    public const string ConversacionesPasajeros = Prefix + "/conversaciones-pasajeros";
    public const string ViajesPublicos = Prefix + "/public/viajes";
}
