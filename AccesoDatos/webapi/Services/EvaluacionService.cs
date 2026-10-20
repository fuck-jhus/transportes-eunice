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
        await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => ProcesarEvaluacionesTransactionalAsync(anio, mes));
    }

    private async Task ProcesarEvaluacionesTransactionalAsync(int anio, int mes)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var (periodStart, periodEnd) = ObservationCoverage.Month(anio, mes);
        var dateKey = DateOnly.FromDateTime(periodStart);
        var calculationEnd = DateTime.UtcNow < periodEnd ? DateTime.UtcNow : periodEnd;

        var pilots = await _context.Usuarios
            .AsNoTracking()
            .Where(user => (user.TipoRol == "Piloto" && user.Estado == "Activo") || user.ViajeDiarios.Any(t => t.FechaInicio < periodEnd && (!t.FechaFin.HasValue || t.FechaFin >= periodStart)))
            .Select(user => new { user.IdUsuario, user.NombreCompleto })
            .ToListAsync();

        var trips = await _context.ViajesDiarios
            .AsNoTracking()
            .Where(trip => trip.FechaInicio < periodEnd && (!trip.FechaFin.HasValue || trip.FechaFin >= periodStart))
            .Select(trip => new { trip.IdViaje, trip.IdUsuario, trip.FechaInicio, trip.FechaFin })
            .ToListAsync();

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

        var samples = await _context.TelemetriaIots.AsNoTracking()
            .Where(t => t.FechaHoraDispositivo >= periodStart && t.FechaHoraDispositivo < calculationEnd)
            .Include(t => t.IdViajeNavigation).ToListAsync();

        foreach (var pilot in pilots)
        {
            var pilotTrips = trips.Where(trip => trip.IdUsuario == pilot.IdUsuario).ToList();
            var scheduledSeconds = pilotTrips.Sum(trip =>
            {
                var effectiveEnd = trip.FechaFin ?? calculationEnd;
                if (effectiveEnd > calculationEnd) effectiveEnd = calculationEnd;
                var start = trip.FechaInicio < periodStart ? periodStart : trip.FechaInicio;
                if (effectiveEnd <= start) return 0d;
                return (effectiveEnd - start).TotalSeconds;
            });
            var coverage = ObservationCoverage.Seconds(samples.Where(x => x.IdViajeNavigation.IdUsuario == pilot.IdUsuario));
            var drivingHours = Math.Round((decimal)coverage.Driving / 3600m, 2, MidpointRounding.AwayFromZero);
            var coveragePercent = scheduledSeconds > 0 ? Math.Min(100m, (decimal)(coverage.Covered / scheduledSeconds * 100)) : 0m;
            var enoughGps = drivingHours >= 0.5m && coveragePercent >= 60m;
            var enoughSensors = coverage.Covered > 0 && coverage.Calibrated / coverage.Covered >= 0.8;

            int CountAlerts(params string[] types) => alerts
                .Where(alert => alert.IdUsuario == pilot.IdUsuario && types.Contains(alert.TipoAlerta))
                .Sum(alert => alert.Count);

            var speedAlerts = CountAlerts("Exceso de Velocidad");
            var brakingAlerts = CountAlerts("Frenado Brusco");
            var maneuverAlerts = CountAlerts("Aceleración Peligrosa", "Giro Brusco");
            var result = EvaluationScoreCalculator.Calculate(speedAlerts, brakingAlerts, maneuverAlerts, drivingHours);

            if (!existing.TryGetValue(pilot.IdUsuario, out var evaluation))
            {
                evaluation = new EvaluacionPilotoMensual
                {
                    IdUsuario = pilot.IdUsuario,
                    MesAnio = dateKey
                };
                _context.EvaluacionesPilotoMensuales.Add(evaluation);
            }

            evaluation.TotalViajes = pilotTrips.Count;
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
