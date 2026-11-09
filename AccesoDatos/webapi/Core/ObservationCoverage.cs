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
        var accumulator = new Accumulator();
        foreach (var reading in readings.OrderBy(x => x.IdViaje).ThenBy(x => x.FechaHoraDispositivo))
            accumulator.Add(new Sample(reading.IdViaje, reading.FechaHoraDispositivo, reading.PrecisionMetros, reading.VelocidadKmh, reading.SensoresCalibrados));
        return accumulator.Result;
    }

    public readonly record struct Sample(int TripId, DateTime ObservedAt, decimal? AccuracyMeters, decimal SpeedKmh, bool SensorsCalibrated);

    /// <summary>
    /// Suma la cobertura de lecturas recibidas en orden (viaje, hora) sin guardarlas en memoria.
    /// Permite recorrer un mes completo de telemetría leyendo una fila a la vez.
    /// </summary>
    public sealed class Accumulator
    {
        private Sample? _previous;
        private double _covered, _driving, _calibrated;

        public (double Covered, double Driving, double Calibrated) Result => (_covered, _driving, _calibrated);

        public void Add(Sample reading)
        {
            if (_previous is { } previous && previous.TripId == reading.TripId)
            {
                var seconds = (reading.ObservedAt - previous.ObservedAt).TotalSeconds;
                if (seconds is > 0 and <= 15 && reading.AccuracyMeters is <= 50 && previous.AccuracyMeters is <= 50)
                {
                    _covered += seconds;
                    if (reading.SpeedKmh > 3 && previous.SpeedKmh > 3) _driving += seconds;
                    if (reading.SensorsCalibrated && previous.SensorsCalibrated) _calibrated += seconds;
                }
            }
            _previous = reading;
        }
    }
}
