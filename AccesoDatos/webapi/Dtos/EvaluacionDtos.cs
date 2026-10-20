using System;
using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos
{
    public class EvaluacionResponseDto
    {
        public int IdEvaluacion { get; set; }
        public int IdUsuario { get; set; }
        public string NombrePiloto { get; set; } = string.Empty;
        public string MesAnio { get; set; } = string.Empty; // Formato "yyyy-MM"
        public int TotalViajes { get; set; }
        public int AlertasVelocidad { get; set; }
        public int AlertasFrenado { get; set; }
        public int AlertasManiobras { get; set; }
        public decimal HorasConduccion { get; set; }
        public decimal PuntosRiesgoPor10Horas { get; set; }
        public decimal? CalificacionDesempeno { get; set; }
        public decimal CoberturaPorcentaje { get; set; }
        public string VersionRegla { get; set; } = "legacy";
        public string CalidadDatos { get; set; } = string.Empty;
    }

    public class ProcesarEvaluacionDto
    {
        [Required(ErrorMessage = "El año es obligatorio.")]
        [Range(2000, 2100, ErrorMessage = "El año debe ser válido.")]
        public int Anio { get; set; }

        [Required(ErrorMessage = "El mes es obligatorio.")]
        [Range(1, 12, ErrorMessage = "El mes debe estar entre 1 y 12.")]
        public int Mes { get; set; }
    }
}
