using webapi.Core;

namespace webapi.Tests;

public class MapRequestValidatorTests
{
    [Fact]
    public void ValidGuatemalaRoute_IsNormalized()
    {
        var valid = MapRequestValidator.TryNormalizePoints(
            "-91.5181,14.8347;-90.5069,14.6349",
            ';',
            3,
            out var normalized);

        Assert.True(valid);
        Assert.Equal("-91.5181,14.8347;-90.5069,14.6349", normalized);
    }

    [Theory]
    [InlineData("-191,14;-90,14")]
    [InlineData("-91,95;-90,14")]
    [InlineData("-91,14")]
    [InlineData("texto,14;-90,14")]
    public void InvalidCoordinates_AreRejected(string points)
    {
        Assert.False(MapRequestValidator.TryNormalizePoints(points, ';', 3, out _));
    }

    [Fact]
    public void RouteWithIdenticalOriginAndDestination_IsRejected()
    {
        Assert.False(MapRequestValidator.TryNormalizePoints(
            "-91.5181,14.8347;-91.5181,14.8347",
            ';',
            3,
            out _));
    }
}
