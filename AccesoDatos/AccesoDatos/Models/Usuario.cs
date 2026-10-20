using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class Usuario
{
    public int IdUsuario { get; set; }

    public string NombreCompleto { get; set; } = null!;

    public string TipoRol { get; set; } = null!;

    public string UsuarioLogin { get; set; } = null!;

    public string Contrasena { get; set; } = null!;

    public string? Estado { get; set; }

    public virtual ICollection<EvaluacionPilotoMensual> EvaluacionPilotoMensuals { get; set; } = new List<EvaluacionPilotoMensual>();

    public virtual ICollection<ViajeDiario> ViajeDiarios { get; set; } = new List<ViajeDiario>();

    public virtual ICollection<ViajeAccesoPublico> AccesosPublicosCreados { get; set; } = new List<ViajeAccesoPublico>();

    public virtual ICollection<MensajePasajero> MensajesPasajeroEnviados { get; set; } = new List<MensajePasajero>();

    public virtual ICollection<DispositivoPush> DispositivosPush { get; set; } = new List<DispositivoPush>();
}
