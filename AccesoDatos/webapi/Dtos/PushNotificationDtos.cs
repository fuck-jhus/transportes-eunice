using System.ComponentModel.DataAnnotations;

namespace webapi.Dtos;

public sealed class RegistrarDispositivoPushDto
{
    [Required]
    [StringLength(200)]
    public string ExpoPushToken { get; set; } = string.Empty;

    [Required]
    [RegularExpression("^(ios|android)$")]
    public string Plataforma { get; set; } = string.Empty;

    [StringLength(120)]
    public string? DeviceId { get; set; }
}

public sealed class EliminarDispositivoPushDto
{
    [Required]
    [StringLength(200)]
    public string ExpoPushToken { get; set; } = string.Empty;
}
