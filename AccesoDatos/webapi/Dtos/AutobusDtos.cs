using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos
{
    public class AutobusResponseDto
    {
        public int IdAutobus { get; set; }
        public string Placa { get; set; } = string.Empty;
        public string? MarcaModelo { get; set; }
        public string Estado { get; set; } = string.Empty;
        public int? IdViajeActivo { get; set; }
        public int? IdPilotoAsignado { get; set; }
        public int? IdRutaAsignada { get; set; }
        public string? NombrePiloto { get; set; }
        public string Disponibilidad { get; set; } = "Sin asignación";
        public byte[] Version { get; set; } = [];
    }

    public class CrearAutobusDto
    {
        [Required(ErrorMessage = "La placa es requerida.")]
        [StringLength(20, ErrorMessage = "La placa no puede exceder los 20 caracteres.")]
        public string Placa { get; set; } = string.Empty;

        [StringLength(100, ErrorMessage = "La marca/modelo no puede exceder los 100 caracteres.")]
        public string? MarcaModelo { get; set; }

        [Required(ErrorMessage = "El estado es requerido.")]
        [RegularExpression("^(Activo|Inactivo|En Taller)$", ErrorMessage = "El estado debe ser 'Activo', 'Inactivo' o 'En Taller'.")]
        public string Estado { get; set; } = "Activo";

        public int? IdPilotoAsignado { get; set; }

        public int? IdRutaAsignada { get; set; }
    }

    public class EditarAutobusDto
    {
        [Required(ErrorMessage = "La placa es requerida.")]
        [StringLength(20, ErrorMessage = "La placa no puede exceder los 20 caracteres.")]
        public string Placa { get; set; } = string.Empty;

        [StringLength(100, ErrorMessage = "La marca/modelo no puede exceder los 100 caracteres.")]
        public string? MarcaModelo { get; set; }

        [Required(ErrorMessage = "El estado es requerido.")]
        [RegularExpression("^(Activo|Inactivo|En Taller)$", ErrorMessage = "El estado debe ser 'Activo', 'Inactivo' o 'En Taller'.")]
        public string Estado { get; set; } = "Activo";

        // Los clientes antiguos pueden seguir editando solamente los datos de la unidad.
        // El panel web establece esta bandera para administrar la asignacion en la misma transaccion.
        public bool GestionarAsignacion { get; set; }
        public int? IdViajeEsperado { get; set; }
        public byte[]? Version { get; set; }

        public int? IdPilotoAsignado { get; set; }

        public int? IdRutaAsignada { get; set; }
    }
}
