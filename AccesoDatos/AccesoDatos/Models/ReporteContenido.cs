namespace AccesoDatos.Models;

public class ReporteContenido
{
    public Guid IdReporte { get; set; }
    public string TipoContenido { get; set; } = string.Empty;
    public Guid IdMensaje { get; set; }
    public Guid? IdConversacion { get; set; }
    public int IdReportante { get; set; }
    public int? IdUsuarioReportado { get; set; }
    public string AliasReportado { get; set; } = string.Empty;
    public string Motivo { get; set; } = string.Empty;
    public string? Detalle { get; set; }
    public string Estado { get; set; } = "Pendiente";
    public DateTime FechaReporte { get; set; }

    public virtual Usuario IdReportanteNavigation { get; set; } = null!;
}
