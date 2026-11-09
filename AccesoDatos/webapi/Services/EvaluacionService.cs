using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using webapi.Core;
using webapi.Dtos;
using System.Data;

namespace webapi.Services;

public class EvaluacionService : IEvaluacionService
{
    private readonly PrevencionAccidentesBusesContext _context;

    public EvaluacionService(PrevencionAccidentesBusesContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task ProcesarEvaluacionesMensualesAsync(int anio, int mes)
    {
        // Las lecturas se resumen fuera de la transacción: leer un mes completo bajo
        // aislamiento serializable bloquearía la telemetría en vivo durante el cálculo.
        var summary = await ResumirPeriodoAsync(anio, mes);
        await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => GuardarEvaluacionesAsync(anio, mes, summary));
    }

    private sealed record PilotSummary(int TripCount, double ScheduledSeconds, double Covered, double Driving, double Calibrated);

    private async Task<Dictionary<int, PilotSummary>> ResumirPeriodoAsync(int anio, int mes)
    {
        var (periodStart, periodEnd) = ObservationCoverage.Month(anio, mes);
        var calculationEnd = DateTime.UtcNow < periodEnd ? DateTime.UtcNow : periodEnd;

        var pilotIds = await _context.Usuarios
            .AsNoTracking()
            .Where(user => (user.TipoRol == "Piloto" && user.Estado == "Activo") || user.ViajeDiarios.Any(t => t.FechaInicio < periodEnd && (!t.FechaFin.HasValue || t.FechaFin >= periodStart)))
            .Select(user => user.IdUsuario)
            .ToListAsync();

        var trips = await _context.ViajesDiarios
            .AsNoTracking()
            .Where(trip => trip.FechaInicio < periodEnd && (!trip.FechaFin.HasValue || trip.FechaFin >= periodStart))
            .Select(trip => new { trip.IdViaje, trip.IdUsuario, trip.FechaInicio, trip.FechaFin })
            .ToListAsync();

        var inRange = _context.TelemetriaIots.AsNoTracking()
            .Where(t => t.FechaHoraDispositivo >= periodStart && t.FechaHoraDispositivo < calculationEnd);

        // Dueño de cada viaje con lecturas en el período.
        var tripOwners = await inRange
            .Select(t => new { t.IdViaje, t.IdViajeNavigation.IdUsuario })
            .Distinct()
            .ToDictionaryAsync(t => t.IdViaje, t => t.IdUsuario);
        var accumulators = new Dictionary<int, ObservationCoverage.Accumulator>();

        // Se procesa un viaje a la vez y solo con las columnas necesarias: la memoria usada
        // depende del viaje más largo, no del total de lecturas del mes de toda la flota.
        // (Con reintentos activados, EF guarda en memoria cada resultado completo antes de
        // entregarlo, por eso no basta con recorrer una sola consulta grande.)
        foreach (var (tripId, ownerId) in tripOwners.OrderBy(pair => pair.Key))
        {
            var samples = await inRange
                .Where(t => t.IdViaje == tripId)
                .OrderBy(t => t.FechaHoraDispositivo)
                .Select(t => new ObservationCoverage.Sample(t.IdViaje, t.FechaHoraDispositivo, t.PrecisionMetros, t.VelocidadKmh, t.SensoresCalibrados))
                .ToListAsync();
            if (!accumulators.TryGetValue(ownerId, out var accumulator))
                accumulators[ownerId] = accumulator = new ObservationCoverage.Accumulator();
            foreach (var sample in samples) accumulator.Add(sample);
        }

        var summary = new Dictionary<int, PilotSummary>();
        foreach (var pilotId in pilotIds.Union(accumulators.Keys))
        {
            var pilotTrips = trips.Where(trip => trip.IdUsuario == pilotId).ToList();
            var scheduledSeconds = pilotTrips.Sum(trip =>
            {
                var effectiveEnd = trip.FechaFin ?? calculationEnd;
                if (effectiveEnd > calculationEnd) effectiveEnd = calculationEnd;
                var start = trip.FechaInicio < periodStart ? periodStart : trip.FechaInicio;
                if (effectiveEnd <= start) return 0d;
                return (effectiveEnd - start).TotalSeconds;
            });
            var coverage = accumulators.TryGetValue(pilotId, out var found) ? found.Result : (0d, 0d, 0d);
            summary[pilotId] = new PilotSummary(pilotTrips.Count, scheduledSeconds, coverage.Item1, coverage.Item2, coverage.Item3);
        }
        return summary;
    }

    private async Task GuardarEvaluacionesAsync(int anio, int mes, IReadOnlyDictionary<int, PilotSummary> summary)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        // Evita que dos procesos (el automático y un administrador) escriban el mismo mes a la vez.
        await TripLifecycle.LockAsync(_context, $"evaluation:{anio}:{mes}");
        var (periodStart, periodEnd) = ObservationCoverage.Month(anio, mes);
        var dateKey = DateOnly.FromDateTime(periodStart);

        var alerts = await _context.AlertaRiesgos
            .AsNoTracking()
            .Where(alert => alert.FechaHora >= periodStart && alert.FechaHora < periodEnd && alert.VersionRegla == "episode-v2")
            .GroupBy(alert => new { alert.IdViajeNavigation.IdUsuario, alert.TipoAlerta })
            .Select(group => new
            {
                group.Key.IdUsuario,
                group.Key.TipoAlerta,
                Count = group.Count()
            })
            .ToListAsync();

        var existing = await _context.EvaluacionesPilotoMensuales
            .Where(evaluation => evaluation.MesAnio == dateKey)
            .ToDictionaryAsync(evaluation => evaluation.IdUsuario);

        foreach (var (pilotId, pilot) in summary)
        {
            var drivingHours = Math.Round((decimal)pilot.Driving / 3600m, 2, MidpointRounding.AwayFromZero);
            var coveragePercent = pilot.ScheduledSeconds > 0 ? Math.Min(100m, (decimal)(pilot.Covered / pilot.ScheduledSeconds * 100)) : 0m;
            var enoughGps = drivingHours >= 0.5m && coveragePercent >= 60m;
            var enoughSensors = pilot.Covered > 0 && pilot.Calibrated / pilot.Covered >= 0.8;

            int CountAlerts(params string[] types) => alerts
                .Where(alert => alert.IdUsuario == pilotId && types.Contains(alert.TipoAlerta))
                .Sum(alert => alert.Count);

            var speedAlerts = CountAlerts("Exceso de Velocidad");
            var brakingAlerts = CountAlerts("Frenado Brusco");
            var maneuverAlerts = CountAlerts("Aceleración Peligrosa", "Giro Brusco");
            var result = EvaluationScoreCalculator.Calculate(speedAlerts, brakingAlerts, maneuverAlerts, drivingHours);

            if (!existing.TryGetValue(pilotId, out var evaluation))
            {
                evaluation = new EvaluacionPilotoMensual
                {
                    IdUsuario = pilotId,
                    MesAnio = dateKey
                };
                _context.EvaluacionesPilotoMensuales.Add(evaluation);
            }

            evaluation.TotalViajes = pilot.TripCount;
            evaluation.AlertasVelocidad = speedAlerts;
            evaluation.AlertasFrenado = brakingAlerts;
            evaluation.AlertasManiobras = maneuverAlerts;
            evaluation.HorasConduccion = drivingHours;
            evaluation.PuntosRiesgoPor10Horas = result.RiskPointsPer10Hours;
            evaluation.CalificacionDesempeno = enoughGps && enoughSensors ? result.Score : null;
            evaluation.CoberturaPorcentaje = Math.Round(coveragePercent, 2);
            evaluation.VersionRegla = ObservationCoverage.RuleVersion;
            evaluation.CalidadDatos = !enoughGps ? "Cobertura GPS insuficiente para calificar" : !enoughSensors ? "Solo GPS; maniobras no evaluables sin sensores calibrados" : "Cobertura suficiente";
        }

        await PushOutbox.AddAsync(_context, $"evaluation:{anio}:{mes}", "Evaluación mensual disponible",
            $"Se consolidaron las evaluaciones de {anio}-{mes:D2}. Consulta el ranking en Alertas.",
            new Dictionary<string, string?> { ["type"] = "evaluation_ready", ["tab"] = "alerts",
                ["section"] = "ranking", ["period"] = $"{anio}-{mes:D2}" }, roles: PushOutbox.Operators);
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    public async Task<IEnumerable<EvaluacionResponseDto>> GetEvaluacionesMensualesAsync(int? anio, int? mes)
    {
        var query = _context.EvaluacionesPilotoMensuales
            .AsNoTracking()
            .AsQueryable();

        if (anio.HasValue)
        {
            query = query.Where(evaluation => evaluation.MesAnio.Year == anio.Value);
        }

        if (mes.HasValue)
        {
            query = query.Where(evaluation => evaluation.MesAnio.Month == mes.Value);
        }

        var evaluations = await query
            .Include(evaluation => evaluation.IdUsuarioNavigation)
            .OrderByDescending(evaluation => evaluation.MesAnio)
            .ThenByDescending(evaluation => evaluation.CalificacionDesempeno)
            .ToListAsync();

        return evaluations.Select(evaluation => new EvaluacionResponseDto
            {
                IdEvaluacion = evaluation.IdEvaluacion,
                IdUsuario = evaluation.IdUsuario,
                NombrePiloto = evaluation.IdUsuarioNavigation.NombreCompleto,
                MesAnio = $"{evaluation.MesAnio.Year}-{evaluation.MesAnio.Month:D2}",
                TotalViajes = evaluation.TotalViajes ?? 0,
                AlertasVelocidad = evaluation.AlertasVelocidad ?? 0,
                AlertasFrenado = evaluation.AlertasFrenado ?? 0,
                AlertasManiobras = evaluation.AlertasManiobras ?? 0,
                HorasConduccion = evaluation.HorasConduccion,
                PuntosRiesgoPor10Horas = evaluation.PuntosRiesgoPor10Horas,
                CalificacionDesempeno = evaluation.VersionRegla == ObservationCoverage.RuleVersion ? evaluation.CalificacionDesempeno : null,
                CoberturaPorcentaje = evaluation.CoberturaPorcentaje,
                VersionRegla = evaluation.VersionRegla,
                CalidadDatos = evaluation.CalidadDatos ?? "Evaluación histórica sin cobertura comprobada"
            });
    }
}
