using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class Autobus
{
    public int IdAutobus { get; set; }

    public string Placa { get; set; } = null!;

    public string? MarcaModelo { get; set; }

    public string? Estado { get; set; }

    // Código fijo del QR pegado en la unidad. Abre el viaje en curso del bus.
    public string? CodigoPublico { get; set; }

    public virtual ICollection<ViajeDiario> ViajeDiarios { get; set; } = new List<ViajeDiario>();
}
