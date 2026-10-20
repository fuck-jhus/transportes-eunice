using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos;

public sealed class CrearAccesoPublicoDto
{
    public bool Rotar { get; set; }
    public bool ChatHabilitado { get; set; } = true;
}

public sealed class AccesoPublicoViajeDto
{
    public bool Activo { get; set; }
    public string? Token { get; set; }
    public DateTime? FechaExpiracion { get; set; }
    public bool ChatHabilitado { get; set; }
}

public sealed class IniciarSesionPasajeroDto
{
    [StringLength(60)]
    public string? Alias { get; set; }
}

public sealed class EnviarMensajePasajeroDto
{
    [Required]
    [StringLength(500, MinimumLength = 1)]
    public string Contenido { get; set; } = string.Empty;

    [StringLength(64, MinimumLength = 8)]
    [RegularExpression("^[A-Za-z0-9_-]+$")]
    public string? IdCliente { get; set; }
}

public sealed class EnviarRespuestaPasajeroDto
{
    public Guid? IdCliente { get; set; }
    [Required]
    [StringLength(500, MinimumLength = 1)]
    public string Contenido { get; set; } = string.Empty;

    public bool RespuestaRapida { get; set; }
}

public sealed class PosicionPublicaDto
{
    public decimal Latitud { get; set; }
    public decimal Longitud { get; set; }
    public DateTime FechaHora { get; set; }
}

public sealed class ViajePublicoDto
{
    public string EstadoViaje { get; set; } = string.Empty;
    public string NombreRuta { get; set; } = string.Empty;
    public string Origen { get; set; } = string.Empty;
    public string Destino { get; set; } = string.Empty;
    public string Unidad { get; set; } = string.Empty;
    public string Conductor { get; set; } = string.Empty;
    public DateTime FechaInicio { get; set; }
    public DateTime? FechaFin { get; set; }
    public bool ChatHabilitado { get; set; }
    public bool ModoPrivacidad { get; set; }
    public bool UbicacionDisponible { get; set; }
    public bool UbicacionDesactualizada { get; set; }
    public PosicionPublicaDto? PosicionActual { get; set; }
    public decimal? DestinoLatitud { get; set; }
    public decimal? DestinoLongitud { get; set; }
    public string? DestinoNombre { get; set; }
    public IReadOnlyList<PosicionPublicaDto> Recorrido { get; set; } = [];
}

public sealed class RutaPublicaDto
{
    public IReadOnlyList<decimal[]> Coordenadas { get; set; } = [];
    public decimal DistanciaKm { get; set; }
    public decimal DuracionMinutos { get; set; }
}

public sealed class SesionPasajeroDto
{
    public Guid IdConversacion { get; set; }
    public string Alias { get; set; } = string.Empty;
    public bool Bloqueada { get; set; }
}

public sealed class MensajePasajeroDto
{
    public int? IdUsuarioEmisor { get; set; }
    public Guid IdMensaje { get; set; }
    public Guid IdConversacion { get; set; }
    public string TipoEmisor { get; set; } = string.Empty;
    public string NombreEmisor { get; set; } = string.Empty;
    public string Contenido { get; set; } = string.Empty;
    public string? IdCliente { get; set; }
    public DateTime FechaHora { get; set; }
    public DateTime? FechaLectura { get; set; }
}

public sealed class ConversacionPasajeroDto
{
    public Guid IdConversacion { get; set; }
    public int IdViaje { get; set; }
    public string AliasPasajero { get; set; } = string.Empty;
    public string NombreRuta { get; set; } = string.Empty;
    public string Unidad { get; set; } = string.Empty;
    public DateTime FechaUltimaActividad { get; set; }
    public bool Bloqueada { get; set; }
    public int NoLeidos { get; set; }
    public string? UltimoMensaje { get; set; }
}

public sealed class PassengerReadReceiptDto
{
    [Required, MaxLength(200)] public Guid[] IdsMensaje { get; set; } = [];
}
