using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class TelemetriaIot
{
    public long IdTelemetria { get; set; }

    public int IdViaje { get; set; }

    public decimal Latitud { get; set; }

    public decimal Longitud { get; set; }

    public decimal VelocidadKmh { get; set; }

    public decimal? AceleracionX { get; set; }

    public decimal? AceleracionY { get; set; }

    public decimal? AceleracionZ { get; set; }

    public decimal? GiroscopioX { get; set; }

    public decimal? GiroscopioY { get; set; }

    public decimal? GiroscopioZ { get; set; }

    public DateTime FechaHoraDispositivo { get; set; }

    public DateTime? FechaHoraServidor { get; set; }

    public virtual ICollection<AlertaRiesgo> AlertaRiesgos { get; set; } = new List<AlertaRiesgo>();

    public virtual ViajeDiario IdViajeNavigation { get; set; } = null!;
}
