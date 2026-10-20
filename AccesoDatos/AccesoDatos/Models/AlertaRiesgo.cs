using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class AlertaRiesgo
{
    public long IdAlerta { get; set; }

    public long IdTelemetria { get; set; }

    public int IdViaje { get; set; }

    public string TipoAlerta { get; set; } = null!;

    public decimal ValorRegistrado { get; set; }

    public decimal? LimitePermitido { get; set; }

    public DateTime FechaHora { get; set; }

    public virtual TelemetriaIot IdTelemetriaNavigation { get; set; } = null!;

    public virtual ViajeDiario IdViajeNavigation { get; set; } = null!;
}
