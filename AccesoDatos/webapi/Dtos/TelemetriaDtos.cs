using System;
using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos
{
    public class CrearTelemetriaDto
    {
        [StringLength(100, MinimumLength = 1)]
        [RegularExpression("^[a-zA-Z0-9_.:-]+$")]
        public string? IdLectura { get; set; }
        [StringLength(100, MinimumLength = 1)]
        [RegularExpression("^[a-zA-Z0-9_.:-]+$")]
        public string? IdFuente { get; set; }
        public bool SensoresCalibrados { get; set; }
        [Range(0, 10000)]
        public decimal? PrecisionMetros { get; set; }
        [Range(1, int.MaxValue)]
        public int? IdViaje { get; set; }
        [Required(ErrorMessage = "La latitud es obligatoria.")]
        [Range(-90.0, 90.0, ErrorMessage = "La latitud debe estar comprendida entre -90 y 90 grados.")]
        public decimal Latitud { get; set; }

        [Required(ErrorMessage = "La longitud es obligatoria.")]
        [Range(-180.0, 180.0, ErrorMessage = "La longitud debe estar comprendida entre -180 y 180 grados.")]
        public decimal Longitud { get; set; }

        [Required(ErrorMessage = "La velocidad es obligatoria.")]
        [Range(0.0, 300.0, ErrorMessage = "La velocidad debe ser un valor positivo válido entre 0 y 300 km/h.")]
        public decimal VelocidadKmh { get; set; }

        // Course in degrees clockwise from true north; independent of gyro rate.
        [Range(0.0, 359.999999, ErrorMessage = "El rumbo debe estar entre 0 y menos de 360 grados.")]
        public decimal? Heading { get; set; }

        [Range(typeof(decimal), "-999.99", "999.99", ErrorMessage = "La aceleración X está fuera del rango permitido.")]
        public decimal? AceleracionX { get; set; }

        [Range(typeof(decimal), "-999.99", "999.99", ErrorMessage = "La aceleración Y está fuera del rango permitido.")]
        public decimal? AceleracionY { get; set; }

        [Range(typeof(decimal), "-999.99", "999.99", ErrorMessage = "La aceleración Z está fuera del rango permitido.")]
        public decimal? AceleracionZ { get; set; }

        [Range(typeof(decimal), "-999.99", "999.99", ErrorMessage = "El giroscopio X está fuera del rango permitido.")]
        public decimal? GiroscopioX { get; set; }

        [Range(typeof(decimal), "-999.99", "999.99", ErrorMessage = "El giroscopio Y está fuera del rango permitido.")]
        public decimal? GiroscopioY { get; set; }

        [Range(typeof(decimal), "-999.99", "999.99", ErrorMessage = "El giroscopio Z está fuera del rango permitido.")]
        public decimal? GiroscopioZ { get; set; }

        [Range(-90.0, 90.0, ErrorMessage = "La latitud del destino debe estar comprendida entre -90 y 90 grados.")]
        public decimal? DestinoLat { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "La longitud del destino debe estar comprendida entre -180 y 180 grados.")]
        public decimal? DestinoLng { get; set; }

        [StringLength(150, ErrorMessage = "El nombre del destino no puede exceder 150 caracteres.")]
        public string? DestinoNombre { get; set; }

        [Required(ErrorMessage = "La fecha y hora del dispositivo es obligatoria.")]
        public DateTime FechaHoraDispositivo { get; set; }
    }

    public class ActualizarEstadoTelemetriaDto
    {
        public bool IsPrivacyMode { get; set; }
    }

    public record TelemetryReceipt(string IdLectura, string Estado, string? Codigo = null, string? Mensaje = null);
    public record TelemetryBatchReceipt(IReadOnlyList<TelemetryReceipt> Lecturas);

    public class TelemetriaLiveDto
    {
        public long IdTelemetria { get; set; }
        public int IdViaje { get; set; }
        public decimal Latitud { get; set; }
        public decimal Longitud { get; set; }
        public decimal VelocidadKmh { get; set; }
        public decimal? Heading { get; set; }
        public decimal? AceleracionX { get; set; }
        public decimal? AceleracionY { get; set; }
        public decimal? AceleracionZ { get; set; }
        public decimal? GiroscopioX { get; set; }
        public decimal? GiroscopioY { get; set; }
        public decimal? GiroscopioZ { get; set; }
        public DateTime FechaHoraDispositivo { get; set; }
        public string PlacaAutobus { get; set; } = string.Empty;
        public string NombrePiloto { get; set; } = string.Empty;
        public string NombreRuta { get; set; } = string.Empty;
        public decimal? DestinoLat { get; set; }
        public decimal? DestinoLng { get; set; }
        public string? DestinoNombre { get; set; }
        public bool? IsTripActive { get; set; }
        public bool IsPrivacyMode { get; set; }
    }

    public class AlertaResponseDto
    {
        public DateTime? FechaRecepcion { get; set; }
        public DateTime? FechaUltimaObservacion { get; set; }
        public string VersionRegla { get; set; } = "legacy";
        public long IdAlerta { get; set; }
        public long IdTelemetria { get; set; }
        public int IdViaje { get; set; }
        public string TipoAlerta { get; set; } = string.Empty;
        public decimal ValorRegistrado { get; set; }
        public decimal? LimitePermitido { get; set; }
        public DateTime FechaHora { get; set; }
        public string PlacaAutobus { get; set; } = string.Empty;
        public string NombrePiloto { get; set; } = string.Empty;
        public string NombreRuta { get; set; } = string.Empty;
    }

    public class EstadisticasAlertasDto
    {
        public int RegistrosHistoricos { get; set; }
        public int Episodios { get; set; }
        public int TotalAlertas { get; set; }
        public Dictionary<string, int> AlertasPorTipo { get; set; } = new Dictionary<string, int>();
        public List<PilotoInfraccionDto> PilotosMasInfracciones { get; set; } = new List<PilotoInfraccionDto>();
    }

    public class PilotoInfraccionDto
    {
        public string NombrePiloto { get; set; } = string.Empty;
        public int CantidadAlertas { get; set; }
    }
}
