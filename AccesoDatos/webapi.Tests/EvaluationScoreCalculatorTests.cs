using webapi.Core;

namespace webapi.Tests;

public class EvaluationScoreCalculatorTests
{
    [Fact]
    public void NoAlerts_ReturnsPerfectScore()
    {
        var result = EvaluationScoreCalculator.Calculate(0, 0, 0, 42m);

        Assert.Equal(100m, result.Score);
        Assert.Equal(0m, result.RiskPointsPer10Hours);
    }

    [Fact]
    public void SameRiskAcrossMoreHours_ProducesFairerScore()
    {
        var shortShift = EvaluationScoreCalculator.Calculate(2, 1, 1, 5m);
        var longShift = EvaluationScoreCalculator.Calculate(2, 1, 1, 20m);

        Assert.True(longShift.Score > shortShift.Score);
        Assert.True(longShift.RiskPointsPer10Hours < shortShift.RiskPointsPer10Hours);
    }

    [Fact]
    public void ExcessiveRisk_NeverProducesNegativeScore()
    {
        var result = EvaluationScoreCalculator.Calculate(100, 100, 100, 1m);

        Assert.Equal(0m, result.Score);
    }
}
