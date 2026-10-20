namespace AccesoDatos.Models;

public class ConversacionPasajero
{
    public Guid IdConversacion { get; set; }
    public Guid IdAcceso { get; set; }
    public string SesionHash { get; set; } = string.Empty;
    public string AliasPasajero { get; set; } = string.Empty;
    public DateTime FechaCreacion { get; set; }
    public DateTime FechaUltimaActividad { get; set; }
    public bool Bloqueada { get; set; }
    public DateTime? FechaLecturaOperador { get; set; }
    public DateTime? FechaLecturaPasajero { get; set; }

    public virtual ViajeAccesoPublico IdAccesoNavigation { get; set; } = null!;
    public virtual ICollection<MensajePasajero> Mensajes { get; set; } = new List<MensajePasajero>();
}
