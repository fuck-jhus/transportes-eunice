namespace AccesoDatos.Models;

public class ParadaRuta
{
    public int IdParada { get; set; }
    public int IdRuta { get; set; }
    public int Orden { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public decimal Latitud { get; set; }
    public decimal Longitud { get; set; }

    public virtual Rutum IdRutaNavigation { get; set; } = null!;
}
