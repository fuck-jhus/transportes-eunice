namespace webapi.Core;

public sealed record EvaluationScore(decimal Score, decimal RiskPointsPer10Hours);

public static class EvaluationScoreCalculator
{
    public static EvaluationScore Calculate(
        int speedAlerts,
        int brakingAlerts,
        int maneuverAlerts,
        decimal drivingHours)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(speedAlerts);
        ArgumentOutOfRangeException.ThrowIfNegative(brakingAlerts);
        ArgumentOutOfRangeException.ThrowIfNegative(maneuverAlerts);
        ArgumentOutOfRangeException.ThrowIfNegative(drivingHours);

        // Los pesos expresan severidad relativa, mientras la exposición evita castigar
        // automáticamente a quien conduce más horas durante el mes.
        var weightedRiskPoints = speedAlerts + (brakingAlerts * 2m) + (maneuverAlerts * 2.5m);
        var exposureHours = Math.Max(drivingHours, 1m);
        var riskPointsPer10Hours = Math.Round(weightedRiskPoints * 10m / exposureHours, 2, MidpointRounding.AwayFromZero);
        var score = Math.Round(Math.Clamp(100m - riskPointsPer10Hours, 0m, 100m), 2, MidpointRounding.AwayFromZero);

        return new EvaluationScore(score, riskPointsPer10Hours);
    }
}
