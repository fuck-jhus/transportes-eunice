using AccesoDatos.Models;

namespace webapi.Core;

public static class ObservationCoverage
{
    public const string RuleVersion = "coverage-v2";
    public static (DateTime Start, DateTime End) Month(int year, int month)
    {
        // Operational month: America/Guatemala, UTC-06, no daylight saving time.
        var start = new DateTime(year, month, 1, 6, 0, 0, DateTimeKind.Utc);
        return (start, start.AddMonths(1));
    }

    public static (double Covered, double Driving, double Calibrated) Seconds(IEnumerable<TelemetriaIot> readings)
    {
        double covered = 0, driving = 0, calibrated = 0;
        foreach (var trip in readings.GroupBy(x => x.IdViaje))
        {
            TelemetriaIot? previous = null;
            foreach (var reading in trip.OrderBy(x => x.FechaHoraDispositivo))
            {
                if (previous != null)
                {
                    var seconds = (reading.FechaHoraDispositivo - previous.FechaHoraDispositivo).TotalSeconds;
                    if (seconds is > 0 and <= 15 && reading.PrecisionMetros is <= 50 && previous.PrecisionMetros is <= 50)
                    {
                        covered += seconds;
                        if (reading.VelocidadKmh > 3 && previous.VelocidadKmh > 3) driving += seconds;
                        if (reading.SensoresCalibrados && previous.SensoresCalibrados) calibrated += seconds;
                    }
                }
                previous = reading;
            }
        }
        return (covered, driving, calibrated);
    }
}
