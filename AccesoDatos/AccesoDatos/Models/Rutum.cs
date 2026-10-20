using System;
using System.Collections.Generic;

namespace AccesoDatos.Models;

public partial class Rutum
{
    public int IdRuta { get; set; }

    public string NombreRuta { get; set; } = null!;

    public string Origen { get; set; } = null!;

    public string Destino { get; set; } = null!;

    public decimal? OrigenLatitud { get; set; }

    public decimal? OrigenLongitud { get; set; }

    public decimal? DestinoLatitud { get; set; }

    public decimal? DestinoLongitud { get; set; }

    public virtual ICollection<ViajeDiario> ViajeDiarios { get; set; } = new List<ViajeDiario>();
}
