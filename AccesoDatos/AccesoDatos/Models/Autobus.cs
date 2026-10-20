using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class Autobus
{
    public int IdAutobus { get; set; }

    public string Placa { get; set; } = null!;

    public string? MarcaModelo { get; set; }

    public string? Estado { get; set; }

    public virtual ICollection<ViajeDiario> ViajeDiarios { get; set; } = new List<ViajeDiario>();
}
