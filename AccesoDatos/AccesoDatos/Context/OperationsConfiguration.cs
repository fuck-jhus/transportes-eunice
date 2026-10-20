using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace AccesoDatos.Context;

public partial class PrevencionAccidentesBusesContext
{
    partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
    {
        ConfigurePushModel(modelBuilder);
        var telemetry = modelBuilder.Entity<TelemetriaIot>();
        telemetry.Property(x => x.IdLectura).HasMaxLength(100).IsUnicode(false).UseCollation("Latin1_General_100_BIN2").HasColumnName("id_lectura");
        telemetry.Property(x => x.HashLectura).HasMaxLength(64).IsUnicode(false).HasColumnName("hash_lectura");
        telemetry.HasIndex(x => new { x.IdViaje, x.IdLectura }).IsUnique().HasFilter("[id_lectura] IS NOT NULL").HasDatabaseName("UX_telemetria_lectura");
        telemetry.Property(x => x.IdFuente).HasMaxLength(100).IsUnicode(false).HasColumnName("id_fuente");
        telemetry.Property(x => x.SensoresCalibrados).HasColumnName("sensores_calibrados");
        telemetry.Property(x => x.PrecisionMetros).HasPrecision(10, 2).HasColumnName("precision_metros");
        telemetry.Property(x => x.FechaHoraDispositivo).HasColumnType("datetime2(7)");
        telemetry.Property(x => x.FechaHoraServidor).HasColumnType("datetime2(7)");
        var alert = modelBuilder.Entity<AlertaRiesgo>();
        alert.Property(x => x.FechaHora).HasColumnType("datetime2(7)");
        alert.Property(x => x.FechaRecepcion).HasColumnName("fecha_recepcion").HasColumnType("datetime2(7)");
        alert.Property(x => x.FechaUltimaObservacion).HasColumnName("fecha_ultima_observacion").HasColumnType("datetime2(7)");
        alert.Property(x => x.VersionRegla).HasColumnName("version_regla").HasMaxLength(30).IsUnicode(false);
        var trip = modelBuilder.Entity<ViajeDiario>();
        trip.Property(x => x.RevisionDestino).HasColumnName("revision_destino");
        trip.Property(x => x.IdOperacion).HasColumnName("id_operacion");
        trip.Property(x => x.HashOperacion).HasMaxLength(100).IsUnicode(false).HasColumnName("hash_operacion");
        trip.HasIndex(x => x.IdOperacion).IsUnique().HasFilter("[id_operacion] IS NOT NULL").HasDatabaseName("UX_viaje_operacion");
        trip.Property(x => x.Version).IsRowVersion().HasColumnName("version");
        trip.Property(x => x.MotivoFinalizacion).HasMaxLength(100).HasColumnName("motivo_finalizacion");
        trip.Property(x => x.NombrePilotoSnapshot).HasMaxLength(100).HasColumnName("nombre_piloto_snapshot");
        trip.Property(x => x.PlacaSnapshot).HasMaxLength(20).HasColumnName("placa_snapshot");
        trip.Property(x => x.NombreRutaSnapshot).HasMaxLength(150).HasColumnName("nombre_ruta_snapshot");
        trip.Property(x => x.OrigenSnapshot).HasMaxLength(150).HasColumnName("origen_snapshot");
        trip.Property(x => x.DestinoSnapshot).HasMaxLength(150).HasColumnName("destino_snapshot");
        trip.Property(x => x.SnapshotHistoricoEstimado).HasColumnName("snapshot_historico_estimado");
        trip.Property(x => x.IdFuenteRastreo).HasMaxLength(100).IsUnicode(false).HasColumnName("id_fuente_rastreo");
        trip.Property(x => x.FuenteRastreoExpira).HasColumnName("fuente_rastreo_expira").HasColumnType("datetime2(7)");
        modelBuilder.Entity<Autobus>().Property(x => x.Version).IsRowVersion().HasColumnName("version");
        modelBuilder.Entity<Usuario>().Property(x => x.Version).IsRowVersion().HasColumnName("version");
        var evaluation = modelBuilder.Entity<EvaluacionPilotoMensual>();
        evaluation.Property(x => x.CoberturaPorcentaje).HasPrecision(5, 2).HasColumnName("cobertura_porcentaje");
        evaluation.Property(x => x.VersionRegla).HasMaxLength(30).IsUnicode(false).HasColumnName("version_regla");
        evaluation.Property(x => x.CalidadDatos).HasMaxLength(150).HasColumnName("calidad_datos");
        evaluation.Property(x => x.CalificacionDesempeno).ValueGeneratedNever();
        var route = modelBuilder.Entity<Rutum>();
        route.Property<string>("NombreRutaNormalizada").HasColumnName("nombre_ruta_normalizada").HasMaxLength(100)
            .HasComputedColumnSql("UPPER(LTRIM(RTRIM([nombre_ruta])))", stored: true);
        // SQL Server cannot filter on a computed column. Match the unfiltered
        // unique index provisioned by the integrity migration.
        route.HasIndex("NombreRutaNormalizada").IsUnique().HasFilter(null).HasDatabaseName("UX_ruta_nombre_normalizado");
        modelBuilder.Entity<ViajeAccesoPublico>().Property(x => x.TokenProtegido).HasColumnName("token_protegido");
        // The API's persisted timestamps are UTC. SQL datetime(2) does not retain
        // DateTime.Kind; restore it so JSON includes Z rather than local ambiguity.
        var utc = new ValueConverter<DateTime, DateTime>(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        foreach (var property in modelBuilder.Model.GetEntityTypes().SelectMany(x => x.GetProperties())
            .Where(x => x.ClrType == typeof(DateTime) || x.ClrType == typeof(DateTime?))) property.SetValueConverter(utc);
    }
}
