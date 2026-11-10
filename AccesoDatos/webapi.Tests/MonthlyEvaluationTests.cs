using AccesoDatos.Context;
using AccesoDatos.Models;
using webapi.Core;
using webapi.Services;

namespace webapi.Tests;

public class MonthlyEvaluationTests
{
    static readonly DateTime TripStart = new(2026, 10, 10, 12, 0, 0, DateTimeKind.Utc);

    static async Task SeedOctober(PrevencionAccidentesBusesContext db)
    {
        db.AddRange(
            new Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", TipoRol = "Piloto", Estado = "Activo", Contrasena = "fixture" },
            new Usuario { IdUsuario = 2, NombreCompleto = "Otro", UsuarioLogin = "pilot2", TipoRol = "Piloto", Estado = "Activo", Contrasena = "fixture" },
            new Autobus { IdAutobus = 1, Placa = "FIX-001", Estado = "Activo" },
            new Autobus { IdAutobus = 2, Placa = "FIX-002", Estado = "Activo" });
        // Dos viajes de 30 minutos del mismo piloto y uno de otro piloto, todos con GPS cada 5 s.
        db.ViajesDiarios.AddRange(
            new ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, FechaInicio = TripStart, FechaFin = TripStart.AddMinutes(30), EstadoViaje = "Finalizado" },
            new ViajeDiario { IdViaje = 2, IdUsuario = 1, IdAutobus = 1, FechaInicio = TripStart.AddHours(2), FechaFin = TripStart.AddHours(2).AddMinutes(30), EstadoViaje = "Finalizado" },
            new ViajeDiario { IdViaje = 3, IdUsuario = 2, IdAutobus = 2, FechaInicio = TripStart, FechaFin = TripStart.AddMinutes(30), EstadoViaje = "Finalizado" });
        foreach (var trip in new[] { (Id: 1, Start: TripStart), (Id: 2, Start: TripStart.AddHours(2)), (Id: 3, Start: TripStart) })
            for (var second = 0; second <= 30 * 60; second += 5)
                db.TelemetriaIots.Add(new TelemetriaIot
                {
                    IdViaje = trip.Id, IdLectura = $"{trip.Id}:{second}", FechaHoraDispositivo = trip.Start.AddSeconds(second),
                    FechaHoraServidor = trip.Start.AddSeconds(second), Latitud = 15, Longitud = -90, VelocidadKmh = 40,
                    PrecisionMetros = 5, SensoresCalibrados = true
                });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Evaluation_AddsCoveragePerTrip_WithoutJoiningSeparateTrips()
    {
        await using var db = TestDb.Create(); await SeedOctober(db);
        var service = new EvaluacionService(db);
        await service.ProcesarEvaluacionesMensualesAsync(2026, 10);

        var ratings = (await service.GetEvaluacionesMensualesAsync(2026, 10)).ToDictionary(x => x.IdUsuario);
        // 2 viajes × 1.800 s cubiertos; el hueco de 90 minutos entre viajes no se cuenta como conducción.
        Assert.Equal(1.00m, ratings[1].HorasConduccion);
        Assert.Equal(100m, ratings[1].CoberturaPorcentaje);
        Assert.Equal(2, ratings[1].TotalViajes);
        Assert.NotNull(ratings[1].CalificacionDesempeno);
        Assert.Equal(0.50m, ratings[2].HorasConduccion);
        Assert.Equal(1, ratings[2].TotalViajes);
    }

    [Fact]
    public void Accumulator_MatchesTheOriginalInMemoryCalculation()
    {
        var start = TripStart;
        var readings = Enumerable.Range(0, 50).Select(i => new TelemetriaIot
        {
            IdViaje = i % 2 + 1, FechaHoraDispositivo = start.AddSeconds(i * 4), VelocidadKmh = i % 7 == 0 ? 0 : 30,
            PrecisionMetros = i % 11 == 0 ? 80 : 5, SensoresCalibrados = i % 3 != 0
        }).ToList();
        var accumulator = new ObservationCoverage.Accumulator();
        foreach (var reading in readings.OrderBy(x => x.IdViaje).ThenBy(x => x.FechaHoraDispositivo))
            accumulator.Add(new(reading.IdViaje, reading.FechaHoraDispositivo, reading.PrecisionMetros, reading.VelocidadKmh, reading.SensoresCalibrados));
        Assert.Equal(ObservationCoverage.Seconds(readings), accumulator.Result);
    }

    [Theory]
    [InlineData("2026-11-02T07:00:00Z", 2026, 10)] // 1:00 del 2 de noviembre en Guatemala: octubre ya cerró hace un día.
    [InlineData("2026-11-01T12:00:00Z", 2026, 9)]  // Todavía dentro del día de gracia de octubre.
    [InlineData("2027-01-03T00:00:00Z", 2026, 12)] // Cambio de año.
    public void PeriodDue_WaitsOneDayAfterTheGuatemalaMonthCloses(string now, int year, int month)
    {
        Assert.Equal((year, month), MonthlyEvaluationService.PeriodDue(DateTime.Parse(now).ToUniversalTime()));
    }

    [Fact]
    public async Task Scheduler_ConsolidatesEachMonthOnlyOnce()
    {
        await using var db = TestDb.Create(); await SeedOctober(db);
        var service = new EvaluacionService(db);
        var now = new DateTime(2026, 11, 2, 7, 0, 0, DateTimeKind.Utc);

        Assert.True(await MonthlyEvaluationService.RunIfDueAsync(db, service, now));
        Assert.False(await MonthlyEvaluationService.RunIfDueAsync(db, service, now.AddHours(1)));
        Assert.Equal(2, db.EvaluacionesPilotoMensuales.Count());
        Assert.Single(db.PushOutboxMessages, x => x.EventKey == "evaluation:2026:10");
    }
}
