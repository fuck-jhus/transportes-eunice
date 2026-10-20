using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class EvaluacionPilotoMensual
{
    public int IdEvaluacion { get; set; }

    public int IdUsuario { get; set; }

    public DateOnly MesAnio { get; set; }

    public int? TotalViajes { get; set; }

    public int? AlertasVelocidad { get; set; }

    public int? AlertasFrenado { get; set; }

    public int? AlertasManiobras { get; set; }

    public decimal HorasConduccion { get; set; }

    public decimal PuntosRiesgoPor10Horas { get; set; }

    public decimal? CalificacionDesempeno { get; set; }

    public virtual Usuario IdUsuarioNavigation { get; set; } = null!;
}
