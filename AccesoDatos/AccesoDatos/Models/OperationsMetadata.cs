namespace AccesoDatos.Models;

public partial class TelemetriaIot
{
    public string? IdLectura { get; set; }
    public string? HashLectura { get; set; }
    public string? IdFuente { get; set; }
    public bool SensoresCalibrados { get; set; }
    public decimal? PrecisionMetros { get; set; }
}

public partial class AlertaRiesgo
{
    public DateTime? FechaRecepcion { get; set; }
    public DateTime? FechaUltimaObservacion { get; set; }
    public string VersionRegla { get; set; } = "legacy";
}

public partial class ViajeDiario
{
    public Guid? IdOperacion { get; set; }
    public string? HashOperacion { get; set; }
    public int RevisionDestino { get; set; }
    public byte[] Version { get; set; } = [];
    public string? MotivoFinalizacion { get; set; }
    public string? NombrePilotoSnapshot { get; set; }
    public string? PlacaSnapshot { get; set; }
    public string? NombreRutaSnapshot { get; set; }
    public string? OrigenSnapshot { get; set; }
    public string? DestinoSnapshot { get; set; }
    public bool SnapshotHistoricoEstimado { get; set; }
    public string? IdFuenteRastreo { get; set; }
    public DateTime? FuenteRastreoExpira { get; set; }
}

public partial class Autobus { public byte[] Version { get; set; } = []; }
public partial class Usuario { public byte[] Version { get; set; } = []; }
public partial class EvaluacionPilotoMensual
{
    public decimal CoberturaPorcentaje { get; set; }
    public string VersionRegla { get; set; } = "legacy";
    public string? CalidadDatos { get; set; }
}
public partial class ViajeAccesoPublico { public string? TokenProtegido { get; set; } }
