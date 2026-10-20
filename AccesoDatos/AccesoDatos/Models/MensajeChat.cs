namespace AccesoDatos.Models;

public class MensajeChat
{
    public Guid IdMensaje { get; set; }
    public int IdEmisor { get; set; }
    public string NombreEmisor { get; set; } = string.Empty;
    public string RolEmisor { get; set; } = string.Empty;
    public int IdPilotoCanal { get; set; }
    public string NombrePilotoCanal { get; set; } = string.Empty;
    public string Contenido { get; set; } = string.Empty;
    public string TipoContenido { get; set; } = "texto";
    public DateTime FechaHora { get; set; }
    public bool Eliminado { get; set; }
    public DateTime? FechaEliminacion { get; set; }
    public int? IdEliminadoPor { get; set; }

    public virtual Usuario IdEmisorNavigation { get; set; } = null!;
    public virtual Usuario? IdEliminadoPorNavigation { get; set; }
}
