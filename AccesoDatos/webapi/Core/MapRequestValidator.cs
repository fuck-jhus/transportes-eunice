using System.Globalization;

namespace webapi.Core;

public static class MapRequestValidator
{
    public static bool TryNormalizePoints(string? input, char separator, int maxPoints, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(input))
        {
            return false;
        }

        var points = input.Split(separator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (points.Length is < 2 || points.Length > maxPoints)
        {
            return false;
        }

        var normalizedPoints = new List<string>(points.Length);
        foreach (var point in points)
        {
            var coordinates = point.Split(',', StringSplitOptions.TrimEntries);
            if (coordinates.Length != 2
                || !decimal.TryParse(coordinates[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var longitude)
                || !decimal.TryParse(coordinates[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var latitude)
                || longitude is < -180 or > 180
                || latitude is < -90 or > 90)
            {
                return false;
            }

            normalizedPoints.Add($"{longitude.ToString(CultureInfo.InvariantCulture)},{latitude.ToString(CultureInfo.InvariantCulture)}");
        }

        if (normalizedPoints.Distinct(StringComparer.Ordinal).Count() < 2)
        {
            return false;
        }

        normalized = string.Join(separator, normalizedPoints);
        return true;
    }
}
