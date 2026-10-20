namespace AccesoDatos.Models;

public sealed class DispositivoPush
{
    public int IdDispositivo { get; set; }

    public int IdUsuario { get; set; }

    public string ExpoPushToken { get; set; } = null!;

    public string Plataforma { get; set; } = null!;

    public string? DeviceId { get; set; }

    public Guid RegistrationId { get; set; } = Guid.NewGuid();

    public DateTime BindingChangedAt { get; set; } = DateTime.UtcNow;

    public bool Activo { get; set; } = true;

    public DateTime FechaRegistro { get; set; }

    public DateTime FechaUltimoUso { get; set; }

    public Usuario IdUsuarioNavigation { get; set; } = null!;
}
