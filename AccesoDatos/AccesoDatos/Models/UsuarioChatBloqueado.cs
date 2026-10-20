namespace AccesoDatos.Models;

public class UsuarioChatBloqueado
{
    public int IdUsuario { get; set; }
    public int IdUsuarioBloqueado { get; set; }
    public DateTime FechaBloqueo { get; set; }

    public virtual Usuario IdUsuarioNavigation { get; set; } = null!;
    public virtual Usuario IdUsuarioBloqueadoNavigation { get; set; } = null!;
}
