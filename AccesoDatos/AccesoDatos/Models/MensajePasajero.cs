namespace AccesoDatos.Models;

public class MensajePasajero
{
    public Guid IdMensaje { get; set; }
    public Guid IdConversacion { get; set; }
    public string TipoEmisor { get; set; } = string.Empty;
    public int? IdUsuarioEmisor { get; set; }
    public string NombreEmisor { get; set; } = string.Empty;
    public string Contenido { get; set; } = string.Empty;
    public string? IdCliente { get; set; }
    public DateTime FechaHora { get; set; }
    public DateTime? FechaEntrega { get; set; }
    public DateTime? FechaLectura { get; set; }

    public virtual ConversacionPasajero IdConversacionNavigation { get; set; } = null!;
    public virtual Usuario? IdUsuarioEmisorNavigation { get; set; }
}
