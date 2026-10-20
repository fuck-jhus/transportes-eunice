namespace AccesoDatos.Models;

public partial class ViajeAccesoPublico
{
    public Guid IdAcceso { get; set; }
    public int IdViaje { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTime FechaCreacion { get; set; }
    public DateTime FechaExpiracion { get; set; }
    public DateTime? FechaRevocacion { get; set; }
    public bool ChatHabilitado { get; set; } = true;
    public int? IdCreadoPor { get; set; }

    public virtual ViajeDiario IdViajeNavigation { get; set; } = null!;
    public virtual Usuario? IdCreadoPorNavigation { get; set; }
    public virtual ICollection<ConversacionPasajero> Conversaciones { get; set; } = new List<ConversacionPasajero>();
}
