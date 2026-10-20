using System;
using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos
{
    public class CrearViajeDto
    {
        public Guid? IdOperacion { get; set; }
        [Required(ErrorMessage = "El piloto (usuario) es requerido.")]
        public int IdUsuario { get; set; }

        [Required(ErrorMessage = "El autobús es requerido.")]
        public int IdAutobus { get; set; }

        public int? IdRuta { get; set; }
    }

    public class ViajeResponseDto
    {
        public int RevisionDestino { get; set; }
        public byte[] Version { get; set; } = [];
        public bool SnapshotHistoricoEstimado { get; set; }
        public int IdViaje { get; set; }
        public int IdUsuario { get; set; }
        public string NombrePiloto { get; set; } = string.Empty;
        public int IdAutobus { get; set; }
        public string PlacaAutobus { get; set; } = string.Empty;
        public int? IdRuta { get; set; }
        public string NombreRuta { get; set; } = string.Empty;
        public string OrigenRuta { get; set; } = string.Empty;
        public string DestinoRuta { get; set; } = string.Empty;
        public decimal? DestinoLatitud { get; set; }
        public decimal? DestinoLongitud { get; set; }
        public string? DestinoNombre { get; set; }
        public DateTime FechaInicio { get; set; }
        public DateTime? FechaFin { get; set; }
        public string EstadoViaje { get; set; } = string.Empty;
    }

    public class GuardarRutaViajeDto
    {
        [Required(ErrorMessage = "El nombre de la ruta es requerido.")]
        [StringLength(100, MinimumLength = 2)]
        public string NombreRuta { get; set; } = string.Empty;

        [Required(ErrorMessage = "El origen es requerido.")]
        [StringLength(100, MinimumLength = 2)]
        public string Origen { get; set; } = string.Empty;

        [Required(ErrorMessage = "El destino es requerido.")]
        [StringLength(100, MinimumLength = 2)]
        public string Destino { get; set; } = string.Empty;

        [Range(-90.0, 90.0)]
        public decimal? OrigenLatitud { get; set; }

        [Range(-180.0, 180.0)]
        public decimal? OrigenLongitud { get; set; }

        [Required]
        [Range(-90.0, 90.0)]
        public decimal? DestinoLatitud { get; set; }

        [Required]
        [Range(-180.0, 180.0)]
        public decimal? DestinoLongitud { get; set; }
    }
}
