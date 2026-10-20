namespace webapi.Services;

public sealed class PushBackgroundService(IServiceScopeFactory scopes, ILogger<PushBackgroundService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<TrackingNotificationMonitor>().CheckAsync(DateTime.UtcNow, stoppingToken);
                await scope.ServiceProvider.GetRequiredService<PushOutboxDispatcher>().ProcessAsync(DateTime.UtcNow, stoppingToken);
                await scope.ServiceProvider.GetRequiredService<GuestWebPushService>().ProcessAsync(DateTime.UtcNow, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                logger.LogError("No se pudo procesar la cola push ({ErrorType}); se reintentará.", ex.GetType().Name);
            }
        }
    }
}
