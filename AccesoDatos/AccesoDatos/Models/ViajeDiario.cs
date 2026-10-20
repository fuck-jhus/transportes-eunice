using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class ViajeDiario
{
    public int IdViaje { get; set; }

    public int IdUsuario { get; set; }

    public int IdAutobus { get; set; }

    public int? IdRuta { get; set; }

    public DateTime FechaInicio { get; set; }

    public DateTime? FechaFin { get; set; }

    public string? EstadoViaje { get; set; }

    public decimal? DestinoLatitud { get; set; }

    public decimal? DestinoLongitud { get; set; }

    public string? DestinoNombre { get; set; }

    public DateTime? NavegacionActualizada { get; set; }

    public bool ModoPrivacidad { get; set; }

    public virtual ICollection<AlertaRiesgo> AlertaRiesgos { get; set; } = new List<AlertaRiesgo>();

    public virtual Autobus IdAutobusNavigation { get; set; } = null!;

    public virtual Rutum? IdRutaNavigation { get; set; }

    public virtual Usuario IdUsuarioNavigation { get; set; } = null!;

    public virtual ICollection<TelemetriaIot> TelemetriaIots { get; set; } = new List<TelemetriaIot>();

    public virtual ICollection<ViajeAccesoPublico> AccesosPublicos { get; set; } = new List<ViajeAccesoPublico>();
}
