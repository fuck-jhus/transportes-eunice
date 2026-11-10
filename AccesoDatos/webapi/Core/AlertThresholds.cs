namespace webapi.Core;

/// <summary>
/// Límites que generan alertas de conducción. Se leen de la sección <c>Alertas</c> de la
/// configuración (appsettings o variables de entorno como <c>Alertas__VelocidadMaximaKmh</c>),
/// así que se pueden ajustar sin recompilar. Los valores por defecto son los que usaba el sistema.
/// </summary>
public sealed class AlertThresholds
{
    public const string SectionName = "Alertas";

    /// <summary>Velocidad por encima de la cual se registra "Exceso de Velocidad" (km/h).</summary>
    public decimal VelocidadMaximaKmh { get; set; } = 80.0M;

    /// <summary>Desaceleración longitudinal para "Frenado Brusco" (m/s², valor positivo).</summary>
    public decimal FrenadoBruscoMs2 { get; set; } = 3.0M;

    /// <summary>Aceleración longitudinal para "Aceleración Peligrosa" (m/s²).</summary>
    public decimal AceleracionPeligrosaMs2 { get; set; } = 3.0M;

    /// <summary>Aceleración lateral para "Giro Brusco" (m/s²).</summary>
    public decimal GiroBruscoLateralMs2 { get; set; } = 3.0M;

    /// <summary>Velocidad de giro para "Giro Brusco" cuando no hay aceleración lateral (rad/s).</summary>
    public decimal GiroBruscoRadS { get; set; } = 2.5M;

    public void Validate()
    {
        if (VelocidadMaximaKmh is <= 0 or > 300 || FrenadoBruscoMs2 <= 0 || AceleracionPeligrosaMs2 <= 0
            || GiroBruscoLateralMs2 <= 0 || GiroBruscoRadS <= 0)
            throw new InvalidOperationException($"La sección de configuración '{SectionName}' tiene límites fuera de rango; deben ser positivos y la velocidad no mayor a 300 km/h.");
    }
}
