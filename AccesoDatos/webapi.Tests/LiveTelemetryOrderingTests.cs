using System.ComponentModel.DataAnnotations;
using webapi.Core;
using webapi.Dtos;
using Xunit;

namespace webapi.Tests;

public class LiveTelemetryOrderingTests
{
    [Theory]
    [InlineData(-1, false)]
    [InlineData(360, false)]
    [InlineData(0, true)]
    [InlineData(90, true)]
    public void HeadingContract_UsesDegreesNotGyroRate(int heading, bool expected)
    {
        var dto = new CrearTelemetriaDto { Latitud = 14.8m, Longitud = -91.5m,
            VelocidadKmh = 30m, Heading = heading, FechaHoraDispositivo = DateTime.UtcNow };
        Assert.Equal(expected, Validator.TryValidateObject(dto, new ValidationContext(dto), new List<ValidationResult>(), true));
    }

    [Fact]
    public async Task HistoryBatch_CannotRewindNewerSocketSnapshot()
    {
        var plate = "ORDER-" + Guid.NewGuid().ToString("N");
        var now = DateTime.UtcNow;
        await WebSocketConnectionManager.BroadcastTelemetryAsync(new TelemetriaLiveDto {
            PlacaAutobus = plate, FechaHoraDispositivo = now, Latitud = 14.8m, Longitud = -91.5m, Heading = 90m });
        await WebSocketConnectionManager.BroadcastTelemetryAsync(new TelemetriaLiveDto {
            PlacaAutobus = plate, FechaHoraDispositivo = now.AddSeconds(-5), Latitud = 14m, Longitud = -90m, Heading = 0m });
        var live = Assert.Single(WebSocketConnectionManager.GetActiveTelemetry(), x => x.PlacaAutobus == plate);
        Assert.Equal(14.8m, live.Latitud); Assert.Equal(90m, live.Heading);
        await WebSocketConnectionManager.BroadcastPilotOfflineAsync(1, plate, "Test");
    }

    [Fact]
    public async Task OfflineHistory_IsNotPublishedAsCurrentLocation()
    {
        var plate = "STALE-" + Guid.NewGuid().ToString("N");
        await WebSocketConnectionManager.BroadcastTelemetryAsync(new TelemetriaLiveDto {
            PlacaAutobus = plate, FechaHoraDispositivo = DateTime.UtcNow.AddMinutes(-3), Latitud = 14.8m, Longitud = -91.5m });
        Assert.DoesNotContain(WebSocketConnectionManager.GetActiveTelemetry(), x => x.PlacaAutobus == plate);
    }
}
