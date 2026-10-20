using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos
{
    public class RutaResponseDto
    {
        public int IdRuta { get; set; }
        public string NombreRuta { get; set; } = string.Empty;
        public string Origen { get; set; } = string.Empty;
        public string Destino { get; set; } = string.Empty;
        public decimal? OrigenLatitud { get; set; }
        public decimal? OrigenLongitud { get; set; }
        public decimal? DestinoLatitud { get; set; }
        public decimal? DestinoLongitud { get; set; }
    }

    public class CrearRutaDto
    {
        [Required(ErrorMessage = "El nombre de la ruta es requerido.")]
        [StringLength(100, ErrorMessage = "El nombre de la ruta no puede exceder los 100 caracteres.")]
        public string NombreRuta { get; set; } = string.Empty;

        [Required(ErrorMessage = "El origen es requerido.")]
        [StringLength(100, ErrorMessage = "El origen no puede exceder los 100 caracteres.")]
        public string Origen { get; set; } = string.Empty;

        [Required(ErrorMessage = "El destino es requerido.")]
        [StringLength(100, ErrorMessage = "El destino no puede exceder los 100 caracteres.")]
        public string Destino { get; set; } = string.Empty;

        [Range(-90.0, 90.0)]
        public decimal? OrigenLatitud { get; set; }

        [Range(-180.0, 180.0)]
        public decimal? OrigenLongitud { get; set; }

        [Range(-90.0, 90.0)]
        public decimal? DestinoLatitud { get; set; }

        [Range(-180.0, 180.0)]
        public decimal? DestinoLongitud { get; set; }
    }

    public class EditarRutaDto
    {
        [Required(ErrorMessage = "El nombre de la ruta es requerido.")]
        [StringLength(100, ErrorMessage = "El nombre de la ruta no puede exceder los 100 caracteres.")]
        public string NombreRuta { get; set; } = string.Empty;

        [Required(ErrorMessage = "El origen es requerido.")]
        [StringLength(100, ErrorMessage = "El origen no puede exceder los 100 caracteres.")]
        public string Origen { get; set; } = string.Empty;

        [Required(ErrorMessage = "El destino es requerido.")]
        [StringLength(100, ErrorMessage = "El destino no puede exceder los 100 caracteres.")]
        public string Destino { get; set; } = string.Empty;

        [Range(-90.0, 90.0)]
        public decimal? OrigenLatitud { get; set; }

        [Range(-180.0, 180.0)]
        public decimal? OrigenLongitud { get; set; }

        [Range(-90.0, 90.0)]
        public decimal? DestinoLatitud { get; set; }

        [Range(-180.0, 180.0)]
        public decimal? DestinoLongitud { get; set; }
    }
}
