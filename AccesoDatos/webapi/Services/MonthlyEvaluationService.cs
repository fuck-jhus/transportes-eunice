using AccesoDatos.Context;
using Microsoft.EntityFrameworkCore;
using webapi.Core;

namespace webapi.Services;

/// <summary>
/// Consolida automáticamente la evaluación del mes anterior. Espera un día después del cierre
/// para incluir las lecturas que los teléfonos envían tarde al recuperar la conexión.
/// Un administrador puede seguir recalculando cualquier mes desde el panel.
/// </summary>
public sealed class MonthlyEvaluationService(IServiceScopeFactory scopes, ILogger<MonthlyEvaluationService> logger) : BackgroundService
{
    public static readonly TimeSpan GracePeriod = TimeSpan.FromDays(1);

    /// <summary>Mes operativo (hora de Guatemala) que ya debería estar consolidado en <paramref name="nowUtc"/>.</summary>
    public static (int Year, int Month) PeriodDue(DateTime nowUtc)
    {
        var local = nowUtc.AddHours(-6) - GracePeriod;
        var previous = new DateTime(local.Year, local.Month, 1).AddMonths(-1);
        return (previous.Year, previous.Month);
    }

    public static async Task<bool> RunIfDueAsync(PrevencionAccidentesBusesContext db, IEvaluacionService evaluations, DateTime nowUtc, CancellationToken ct = default)
    {
        var (year, month) = PeriodDue(nowUtc);
        // La marca de notificación se guarda en la misma transacción que las evaluaciones,
        // así que su existencia indica que ese mes ya se consolidó (automática o manualmente).
        if (await db.PushNotificationMarkers.AnyAsync(x => x.EventKey == $"evaluation:{year}:{month}", ct)) return false;
        await evaluations.ProcesarEvaluacionesMensualesAsync(year, month);
        return true;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<PrevencionAccidentesBusesContext>();
                var evaluations = scope.ServiceProvider.GetRequiredService<IEvaluacionService>();
                if (await RunIfDueAsync(db, evaluations, DateTime.UtcNow, stoppingToken))
                    logger.LogInformation("Evaluación mensual consolidada automáticamente.");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                logger.LogError("No se pudo consolidar la evaluación mensual ({ErrorType}); se reintentará.", ex.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
