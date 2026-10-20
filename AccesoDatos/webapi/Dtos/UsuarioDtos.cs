using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos
{
    public class CrearUsuarioDto
    {
        [Required(ErrorMessage = "El nombre completo es requerido.")]
        [StringLength(100, ErrorMessage = "El nombre completo no puede exceder los 100 caracteres.")]
        public string NombreCompleto { get; set; } = string.Empty;

        [Required(ErrorMessage = "El rol es requerido.")]
        [RegularExpression("^(Piloto|Administrador|Supervisor)$", ErrorMessage = "El rol debe ser 'Piloto', 'Administrador' o 'Supervisor'.")]
        public string TipoRol { get; set; } = string.Empty;

        [Required(ErrorMessage = "El nombre de usuario es requerido.")]
        [StringLength(50, ErrorMessage = "El usuario no puede exceder los 50 caracteres.")]
        public string UsuarioLogin { get; set; } = string.Empty;

        [Required(ErrorMessage = "La contraseña es requerida.")]
        [StringLength(128, MinimumLength = 12, ErrorMessage = "La contraseña debe tener entre 12 y 128 caracteres.")]
        public string Contrasena { get; set; } = string.Empty;

        [RegularExpression("^(Activo|Inactivo)$", ErrorMessage = "El estado debe ser 'Activo' o 'Inactivo'.")]
        public string Estado { get; set; } = "Activo";
    }

    public class EditarUsuarioDto
    {
        public byte[]? Version { get; set; }
        [Required(ErrorMessage = "El nombre completo es requerido.")]
        [StringLength(100, ErrorMessage = "El nombre completo no puede exceder los 100 caracteres.")]
        public string NombreCompleto { get; set; } = string.Empty;

        [Required(ErrorMessage = "El rol es requerido.")]
        [RegularExpression("^(Piloto|Administrador|Supervisor)$", ErrorMessage = "El rol debe ser 'Piloto', 'Administrador' o 'Supervisor'.")]
        public string TipoRol { get; set; } = string.Empty;

        [Required(ErrorMessage = "El nombre de usuario es requerido.")]
        [StringLength(50, ErrorMessage = "El usuario no puede exceder los 50 caracteres.")]
        public string UsuarioLogin { get; set; } = string.Empty;

        // Opcional en edición. Si viene vacío o nulo, no se actualizará la contraseña en la BD.
        [StringLength(128, MinimumLength = 12, ErrorMessage = "La contraseña debe tener entre 12 y 128 caracteres.")]
        public string? Contrasena { get; set; }

        [RegularExpression("^(Activo|Inactivo)$", ErrorMessage = "El estado debe ser 'Activo' o 'Inactivo'.")]
        public string? Estado { get; set; }
    }

    public class CambiarEstadoDto
    {
        [Required(ErrorMessage = "El estado es requerido.")]
        [RegularExpression("^(Activo|Inactivo)$", ErrorMessage = "El estado debe ser 'Activo' o 'Inactivo'.")]
        public string Estado { get; set; } = string.Empty;
    }
}
