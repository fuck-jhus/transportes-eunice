using System;
using System.Collections.Generic;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;

namespace AccesoDatos.Context;

public partial class PrevencionAccidentesBusesContext : DbContext
{
    public PrevencionAccidentesBusesContext()
    {
    }

    public PrevencionAccidentesBusesContext(DbContextOptions<PrevencionAccidentesBusesContext> options)
        : base(options)
    {
    }

    public virtual DbSet<AlertaRiesgo> AlertaRiesgos { get; set; }

    public virtual DbSet<Autobus> Autobuses { get; set; }

    public virtual DbSet<EvaluacionPilotoMensual> EvaluacionesPilotoMensuales { get; set; }

    public virtual DbSet<MensajeChat> MensajesChat { get; set; }

    public virtual DbSet<ViajeAccesoPublico> ViajesAccesosPublicos { get; set; }

    public virtual DbSet<ConversacionPasajero> ConversacionesPasajeros { get; set; }

    public virtual DbSet<MensajePasajero> MensajesPasajeros { get; set; }

    public virtual DbSet<ReporteContenido> ReportesContenido { get; set; }

    public virtual DbSet<UsuarioChatBloqueado> UsuariosChatBloqueados { get; set; }

    public virtual DbSet<DispositivoPush> DispositivosPush { get; set; }

    public virtual DbSet<Rutum> Ruta { get; set; }

    public virtual DbSet<TelemetriaIot> TelemetriaIots { get; set; }

    public virtual DbSet<Usuario> Usuarios { get; set; }

    public virtual DbSet<ViajeDiario> ViajesDiarios { get; set; }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        // La configuración de conexión se inyecta vía Dependency Injection en Program.cs
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AlertaRiesgo>(entity =>
        {
            entity.HasKey(e => e.IdAlerta).HasName("PK__alerta_r__1227953E32D0057E");

            entity.ToTable("alerta_riesgo");

            entity.HasIndex(e => e.TipoAlerta, "idx_tipo_alerta");

            entity.Property(e => e.IdAlerta).HasColumnName("id_alerta");
            entity.Property(e => e.FechaHora)
                .HasColumnType("datetime")
                .HasColumnName("fecha_hora");
            entity.Property(e => e.IdTelemetria).HasColumnName("id_telemetria");
            entity.Property(e => e.IdViaje).HasColumnName("id_viaje");
            entity.Property(e => e.LimitePermitido)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("limite_permitido");
            entity.Property(e => e.TipoAlerta)
                .HasMaxLength(30)
                .IsUnicode(false)
                .HasColumnName("tipo_alerta");
            entity.Property(e => e.ValorRegistrado)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("valor_registrado");

            entity.HasOne(d => d.IdTelemetriaNavigation).WithMany(p => p.AlertaRiesgos)
                .HasForeignKey(d => d.IdTelemetria)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__alerta_ri__id_te__628FA481");

            entity.HasOne(d => d.IdViajeNavigation).WithMany(p => p.AlertaRiesgos)
                .HasForeignKey(d => d.IdViaje)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__alerta_ri__id_vi__6383C8BA");
        });

        modelBuilder.Entity<Autobus>(entity =>
        {
            entity.HasKey(e => e.IdAutobus).HasName("PK__autobus__F14EB786917709D8");

            entity.ToTable("autobus");

            entity.HasIndex(e => e.Placa, "UQ__autobus__0C057425CDE7B8D7").IsUnique();

            entity.Property(e => e.IdAutobus).HasColumnName("id_autobus");
            entity.Property(e => e.Estado)
                .HasMaxLength(15)
                .IsUnicode(false)
                .HasDefaultValue("Activo")
                .HasColumnName("estado");
            entity.Property(e => e.MarcaModelo)
                .HasMaxLength(100)
                .IsUnicode(false)
                .HasColumnName("marca_modelo");
            entity.Property(e => e.Placa)
                .HasMaxLength(20)
                .IsUnicode(false)
                .HasColumnName("placa");
        });

        modelBuilder.Entity<EvaluacionPilotoMensual>(entity =>
        {
            entity.HasKey(e => e.IdEvaluacion).HasName("PK__evaluaci__65DE60C53F0FB2C9");

            entity.ToTable("evaluacion_piloto_mensual");

            entity.HasIndex(e => new { e.IdUsuario, e.MesAnio }, "unq_piloto_mes").IsUnique();

            entity.Property(e => e.IdEvaluacion).HasColumnName("id_evaluacion");
            entity.Property(e => e.AlertasFrenado)
                .HasDefaultValue(0)
                .HasColumnName("alertas_frenado");
            entity.Property(e => e.AlertasManiobras)
                .HasDefaultValue(0)
                .HasColumnName("alertas_maniobras");
            entity.Property(e => e.AlertasVelocidad)
                .HasDefaultValue(0)
                .HasColumnName("alertas_velocidad");
            entity.Property(e => e.HorasConduccion)
                .HasDefaultValue(0m)
                .HasColumnType("decimal(10, 2)")
                .HasColumnName("horas_conduccion");
            entity.Property(e => e.PuntosRiesgoPor10Horas)
                .HasDefaultValue(0m)
                .HasColumnType("decimal(10, 2)")
                .HasColumnName("puntos_riesgo_por_10h");
            entity.Property(e => e.CalificacionDesempeno)
                .HasDefaultValue(100.00m)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("calificacion_desempeno");
            entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
            entity.Property(e => e.MesAnio)
                .HasColumnType("date")
                .HasColumnName("mes_anio");
            entity.Property(e => e.TotalViajes)
                .HasDefaultValue(0)
                .HasColumnName("total_viajes");

            entity.HasOne(d => d.IdUsuarioNavigation).WithMany(p => p.EvaluacionPilotoMensuals)
                .HasForeignKey(d => d.IdUsuario)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__evaluacio__id_us__6C190EBB");
        });

        modelBuilder.Entity<MensajeChat>(entity =>
        {
            entity.HasKey(e => e.IdMensaje).HasName("PK_mensaje_chat");

            entity.ToTable("mensaje_chat");

            entity.HasIndex(e => new { e.IdPilotoCanal, e.FechaHora }, "idx_mensaje_chat_canal_fecha");

            entity.Property(e => e.IdMensaje)
                .HasDefaultValueSql("(newsequentialid())")
                .HasColumnName("id_mensaje");
            entity.Property(e => e.IdEmisor).HasColumnName("id_emisor");
            entity.Property(e => e.NombreEmisor)
                .HasMaxLength(100)
                .IsUnicode(false)
                .HasColumnName("nombre_emisor");
            entity.Property(e => e.RolEmisor)
                .HasMaxLength(20)
                .IsUnicode(false)
                .HasColumnName("rol_emisor");
            entity.Property(e => e.IdPilotoCanal).HasColumnName("id_piloto_canal");
            entity.Property(e => e.NombrePilotoCanal)
                .HasMaxLength(100)
                .IsUnicode(false)
                .HasColumnName("nombre_piloto_canal");
            entity.Property(e => e.Contenido)
                .HasMaxLength(2000)
                .HasColumnName("contenido");
            entity.Property(e => e.TipoContenido)
                .HasMaxLength(20)
                .IsUnicode(false)
                .HasDefaultValue("texto")
                .HasColumnName("tipo_contenido");
            entity.Property(e => e.FechaHora)
                .HasColumnType("datetime2")
                .HasDefaultValueSql("(sysutcdatetime())")
                .HasColumnName("fecha_hora");
            entity.Property(e => e.Eliminado)
                .HasDefaultValue(false)
                .HasColumnName("eliminado");
            entity.Property(e => e.FechaEliminacion)
                .HasColumnType("datetime2")
                .HasColumnName("fecha_eliminacion");
            entity.Property(e => e.IdEliminadoPor).HasColumnName("id_eliminado_por");

            entity.HasOne(e => e.IdEmisorNavigation)
                .WithMany()
                .HasForeignKey(e => e.IdEmisor)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_mensaje_chat_emisor");

            entity.HasOne(e => e.IdEliminadoPorNavigation)
                .WithMany()
                .HasForeignKey(e => e.IdEliminadoPor)
                .OnDelete(DeleteBehavior.NoAction)
                .HasConstraintName("FK_mensaje_chat_eliminado_por");
        });

        modelBuilder.Entity<ViajeAccesoPublico>(entity =>
        {
            entity.HasKey(e => e.IdAcceso).HasName("PK_viaje_acceso_publico");
            entity.ToTable("viaje_acceso_publico");
            entity.HasIndex(e => e.TokenHash, "UX_viaje_acceso_token").IsUnique();
            entity.HasIndex(e => new { e.IdViaje, e.FechaRevocacion }, "idx_viaje_acceso_estado");

            entity.Property(e => e.IdAcceso).HasColumnName("id_acceso");
            entity.Property(e => e.IdViaje).HasColumnName("id_viaje");
            entity.Property(e => e.TokenHash).HasMaxLength(64).IsUnicode(false).IsFixedLength().HasColumnName("token_hash");
            entity.Property(e => e.FechaCreacion).HasColumnType("datetime2").HasColumnName("fecha_creacion");
            entity.Property(e => e.FechaExpiracion).HasColumnType("datetime2").HasColumnName("fecha_expiracion");
            entity.Property(e => e.FechaRevocacion).HasColumnType("datetime2").HasColumnName("fecha_revocacion");
            entity.Property(e => e.ChatHabilitado).HasDefaultValue(true).HasColumnName("chat_habilitado");
            entity.Property(e => e.IdCreadoPor).HasColumnName("id_creado_por");

            entity.HasOne(e => e.IdViajeNavigation)
                .WithMany(e => e.AccesosPublicos)
                .HasForeignKey(e => e.IdViaje)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_viaje_acceso_viaje");
            entity.HasOne(e => e.IdCreadoPorNavigation)
                .WithMany(e => e.AccesosPublicosCreados)
                .HasForeignKey(e => e.IdCreadoPor)
                .OnDelete(DeleteBehavior.NoAction)
                .HasConstraintName("FK_viaje_acceso_creador");
        });

        modelBuilder.Entity<ConversacionPasajero>(entity =>
        {
            entity.HasKey(e => e.IdConversacion).HasName("PK_conversacion_pasajero");
            entity.ToTable("conversacion_pasajero");
            entity.HasIndex(e => new { e.IdAcceso, e.SesionHash }, "UX_conversacion_acceso_sesion").IsUnique();
            entity.HasIndex(e => new { e.IdAcceso, e.FechaUltimaActividad }, "idx_conversacion_actividad");

            entity.Property(e => e.IdConversacion).HasColumnName("id_conversacion");
            entity.Property(e => e.IdAcceso).HasColumnName("id_acceso");
            entity.Property(e => e.SesionHash).HasMaxLength(64).IsUnicode(false).IsFixedLength().HasColumnName("sesion_hash");
            entity.Property(e => e.AliasPasajero).HasMaxLength(60).HasColumnName("alias_pasajero");
            entity.Property(e => e.FechaCreacion).HasColumnType("datetime2").HasColumnName("fecha_creacion");
            entity.Property(e => e.FechaUltimaActividad).HasColumnType("datetime2").HasColumnName("fecha_ultima_actividad");
            entity.Property(e => e.Bloqueada).HasColumnName("bloqueada");
            entity.Property(e => e.FechaLecturaOperador).HasColumnType("datetime2").HasColumnName("fecha_lectura_operador");
            entity.Property(e => e.FechaLecturaPasajero).HasColumnType("datetime2").HasColumnName("fecha_lectura_pasajero");

            entity.HasOne(e => e.IdAccesoNavigation)
                .WithMany(e => e.Conversaciones)
                .HasForeignKey(e => e.IdAcceso)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_conversacion_acceso");
        });

        modelBuilder.Entity<MensajePasajero>(entity =>
        {
            entity.HasKey(e => e.IdMensaje).HasName("PK_mensaje_pasajero");
            entity.ToTable("mensaje_pasajero");
            entity.HasIndex(e => new { e.IdConversacion, e.FechaHora }, "idx_mensaje_pasajero_fecha");
            entity.HasIndex(e => new { e.IdConversacion, e.IdCliente }, "UX_mensaje_pasajero_cliente")
                .IsUnique()
                .HasFilter("[id_cliente] IS NOT NULL");

            entity.Property(e => e.IdMensaje).HasColumnName("id_mensaje");
            entity.Property(e => e.IdConversacion).HasColumnName("id_conversacion");
            entity.Property(e => e.TipoEmisor).HasMaxLength(12).IsUnicode(false).HasColumnName("tipo_emisor");
            entity.Property(e => e.IdUsuarioEmisor).HasColumnName("id_usuario_emisor");
            entity.Property(e => e.NombreEmisor).HasMaxLength(100).HasColumnName("nombre_emisor");
            entity.Property(e => e.Contenido).HasMaxLength(500).HasColumnName("contenido");
            entity.Property(e => e.IdCliente).HasMaxLength(64).IsUnicode(false).HasColumnName("id_cliente");
            entity.Property(e => e.FechaHora).HasColumnType("datetime2").HasColumnName("fecha_hora");
            entity.Property(e => e.FechaEntrega).HasColumnType("datetime2").HasColumnName("fecha_entrega");
            entity.Property(e => e.FechaLectura).HasColumnType("datetime2").HasColumnName("fecha_lectura");

            entity.HasOne(e => e.IdConversacionNavigation)
                .WithMany(e => e.Mensajes)
                .HasForeignKey(e => e.IdConversacion)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_mensaje_pasajero_conversacion");
            entity.HasOne(e => e.IdUsuarioEmisorNavigation)
                .WithMany(e => e.MensajesPasajeroEnviados)
                .HasForeignKey(e => e.IdUsuarioEmisor)
                .OnDelete(DeleteBehavior.NoAction)
                .HasConstraintName("FK_mensaje_pasajero_usuario");
        });

        modelBuilder.Entity<DispositivoPush>(entity =>
        {
            entity.HasKey(e => e.IdDispositivo).HasName("PK_dispositivo_push");
            entity.ToTable("dispositivo_push");
            entity.HasIndex(e => e.ExpoPushToken, "UX_dispositivo_push_token").IsUnique();
            entity.HasIndex(e => new { e.IdUsuario, e.Activo }, "idx_dispositivo_push_usuario_activo");

            entity.Property(e => e.IdDispositivo).HasColumnName("id_dispositivo");
            entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
            entity.Property(e => e.ExpoPushToken).HasMaxLength(200).IsUnicode(false).HasColumnName("expo_push_token");
            entity.Property(e => e.Plataforma).HasMaxLength(20).IsUnicode(false).HasColumnName("plataforma");
            entity.Property(e => e.DeviceId).HasMaxLength(120).IsUnicode(false).HasColumnName("device_id");
            entity.Property(e => e.Activo).HasDefaultValue(true).HasColumnName("activo");
            entity.Property(e => e.FechaRegistro).HasColumnType("datetime2").HasColumnName("fecha_registro");
            entity.Property(e => e.FechaUltimoUso).HasColumnType("datetime2").HasColumnName("fecha_ultimo_uso");

            entity.HasOne(e => e.IdUsuarioNavigation)
                .WithMany(e => e.DispositivosPush)
                .HasForeignKey(e => e.IdUsuario)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_dispositivo_push_usuario");
        });

        modelBuilder.Entity<Rutum>(entity =>
        {
            entity.HasKey(e => e.IdRuta).HasName("PK__ruta__33C9344F7A48FE40");

            entity.ToTable("ruta");

            entity.Property(e => e.IdRuta).HasColumnName("id_ruta");
            entity.Property(e => e.Destino)
                .HasMaxLength(100)
                .IsUnicode(false)
                .HasColumnName("destino");
            entity.Property(e => e.NombreRuta)
                .HasMaxLength(100)
                .IsUnicode(false)
                .HasColumnName("nombre_ruta");
            entity.Property(e => e.Origen)
                .HasMaxLength(100)
                .IsUnicode(false)
                .HasColumnName("origen");
            entity.Property(e => e.OrigenLatitud)
                .HasColumnType("decimal(10, 8)")
                .HasColumnName("origen_latitud");
            entity.Property(e => e.OrigenLongitud)
                .HasColumnType("decimal(11, 8)")
                .HasColumnName("origen_longitud");
            entity.Property(e => e.DestinoLatitud)
                .HasColumnType("decimal(10, 8)")
                .HasColumnName("destino_latitud");
            entity.Property(e => e.DestinoLongitud)
                .HasColumnType("decimal(11, 8)")
                .HasColumnName("destino_longitud");
        });

        modelBuilder.Entity<TelemetriaIot>(entity =>
        {
            entity.HasKey(e => e.IdTelemetria).HasName("PK__telemetr__00E9B04CCFF71F17");

            entity.ToTable("telemetria_iot");

            entity.HasIndex(e => e.FechaHoraDispositivo, "idx_fecha_dispositivo");

            entity.HasIndex(e => e.IdViaje, "idx_viaje_telemetria");

            entity.HasIndex(e => new { e.IdViaje, e.FechaHoraDispositivo }, "idx_telemetria_viaje_fecha");

            entity.Property(e => e.IdTelemetria).HasColumnName("id_telemetria");
            entity.Property(e => e.AceleracionX)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("aceleracion_x");
            entity.Property(e => e.AceleracionY)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("aceleracion_y");
            entity.Property(e => e.AceleracionZ)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("aceleracion_z");
            entity.Property(e => e.FechaHoraDispositivo)
                .HasColumnType("datetime")
                .HasColumnName("fecha_hora_dispositivo");
            entity.Property(e => e.FechaHoraServidor)
                .HasDefaultValueSql("(getdate())")
                .HasColumnType("datetime")
                .HasColumnName("fecha_hora_servidor");
            entity.Property(e => e.GiroscopioX)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("giroscopio_x");
            entity.Property(e => e.GiroscopioY)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("giroscopio_y");
            entity.Property(e => e.GiroscopioZ)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("giroscopio_z");
            entity.Property(e => e.IdViaje).HasColumnName("id_viaje");
            entity.Property(e => e.Latitud)
                .HasColumnType("decimal(10, 8)")
                .HasColumnName("latitud");
            entity.Property(e => e.Longitud)
                .HasColumnType("decimal(11, 8)")
                .HasColumnName("longitud");
            entity.Property(e => e.VelocidadKmh)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("velocidad_kmh");

            entity.HasOne(d => d.IdViajeNavigation).WithMany(p => p.TelemetriaIots)
                .HasForeignKey(d => d.IdViaje)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__telemetri__id_vi__5EBF139D");
        });

        modelBuilder.Entity<Usuario>(entity =>
        {
            entity.HasKey(e => e.IdUsuario).HasName("PK__usuario__4E3E04AD31757059");

            entity.ToTable("usuario");

            entity.HasIndex(e => e.UsuarioLogin, "UQ__usuario__4ADECE126BEBBBAC").IsUnique();

            entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
            entity.Property(e => e.Contrasena)
                .HasMaxLength(255)
                .IsUnicode(false)
                .HasColumnName("contrasena");
            entity.Property(e => e.Estado)
                .HasMaxLength(10)
                .IsUnicode(false)
                .HasDefaultValue("Activo")
                .HasColumnName("estado");
            entity.Property(e => e.NombreCompleto)
                .HasMaxLength(100)
                .IsUnicode(false)
                .HasColumnName("nombre_completo");
            entity.Property(e => e.TipoRol)
                .HasMaxLength(20)
                .IsUnicode(false)
                .HasColumnName("tipo_rol");
            entity.Property(e => e.UsuarioLogin)
                .HasMaxLength(50)
                .IsUnicode(false)
                .HasColumnName("usuario_login");
        });

        modelBuilder.Entity<ViajeDiario>(entity =>
        {
            entity.HasKey(e => e.IdViaje).HasName("PK__viaje_di__29535AC305DED9CC");

            entity.ToTable("viaje_diario");

            entity.HasIndex(e => e.IdUsuario, "UX_viaje_piloto_en_curso")
                .IsUnique()
                .HasFilter("[estado_viaje] = 'En Curso'");

            entity.HasIndex(e => e.IdAutobus, "UX_viaje_autobus_en_curso")
                .IsUnique()
                .HasFilter("[estado_viaje] = 'En Curso'");

            entity.Property(e => e.IdViaje).HasColumnName("id_viaje");
            entity.Property(e => e.EstadoViaje)
                .HasMaxLength(15)
                .IsUnicode(false)
                .HasDefaultValue("En Curso")
                .HasColumnName("estado_viaje");
            entity.Property(e => e.FechaFin)
                .HasColumnType("datetime")
                .HasColumnName("fecha_fin");
            entity.Property(e => e.FechaInicio)
                .HasColumnType("datetime")
                .HasColumnName("fecha_inicio");
            entity.Property(e => e.IdAutobus).HasColumnName("id_autobus");
            entity.Property(e => e.IdRuta).HasColumnName("id_ruta");
            entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
            entity.Property(e => e.DestinoLatitud)
                .HasColumnType("decimal(10, 8)")
                .HasColumnName("destino_latitud");
            entity.Property(e => e.DestinoLongitud)
                .HasColumnType("decimal(11, 8)")
                .HasColumnName("destino_longitud");
            entity.Property(e => e.DestinoNombre)
                .HasMaxLength(150)
                .HasColumnName("destino_nombre");
            entity.Property(e => e.NavegacionActualizada)
                .HasColumnType("datetime2")
                .HasColumnName("navegacion_actualizada");
            entity.Property(e => e.ModoPrivacidad)
                .HasDefaultValue(false)
                .HasColumnName("modo_privacidad");

            entity.HasOne(d => d.IdAutobusNavigation).WithMany(p => p.ViajeDiarios)
                .HasForeignKey(d => d.IdAutobus)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__viaje_dia__id_au__59FA5E80");

            entity.HasOne(d => d.IdRutaNavigation).WithMany(p => p.ViajeDiarios)
                .HasForeignKey(d => d.IdRuta)
                .HasConstraintName("FK__viaje_dia__id_ru__5AEE82B9");

            entity.HasOne(d => d.IdUsuarioNavigation).WithMany(p => p.ViajeDiarios)
                .HasForeignKey(d => d.IdUsuario)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__viaje_dia__id_us__59063A47");
        });

        modelBuilder.Entity<ReporteContenido>(entity =>
        {
            entity.HasKey(e => e.IdReporte).HasName("PK_reporte_contenido");
            entity.ToTable("reporte_contenido");
            entity.HasIndex(e => new { e.IdReportante, e.TipoContenido, e.IdMensaje }, "UX_reporte_contenido_unico").IsUnique();
            entity.HasIndex(e => new { e.Estado, e.FechaReporte }, "idx_reporte_contenido_estado");

            entity.Property(e => e.IdReporte).HasColumnName("id_reporte");
            entity.Property(e => e.TipoContenido).HasMaxLength(20).IsUnicode(false).HasColumnName("tipo_contenido");
            entity.Property(e => e.IdMensaje).HasColumnName("id_mensaje");
            entity.Property(e => e.IdConversacion).HasColumnName("id_conversacion");
            entity.Property(e => e.IdReportante).HasColumnName("id_reportante");
            entity.Property(e => e.IdUsuarioReportado).HasColumnName("id_usuario_reportado");
            entity.Property(e => e.AliasReportado).HasMaxLength(100).HasColumnName("alias_reportado");
            entity.Property(e => e.Motivo).HasMaxLength(80).HasColumnName("motivo");
            entity.Property(e => e.Detalle).HasMaxLength(500).HasColumnName("detalle");
            entity.Property(e => e.Estado).HasMaxLength(20).IsUnicode(false).HasDefaultValue("Pendiente").HasColumnName("estado");
            entity.Property(e => e.FechaReporte).HasColumnType("datetime2").HasColumnName("fecha_reporte");

            entity.HasOne(e => e.IdReportanteNavigation)
                .WithMany()
                .HasForeignKey(e => e.IdReportante)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_reporte_contenido_reportante");
        });

        modelBuilder.Entity<UsuarioChatBloqueado>(entity =>
        {
            entity.HasKey(e => new { e.IdUsuario, e.IdUsuarioBloqueado }).HasName("PK_usuario_chat_bloqueado");
            entity.ToTable("usuario_chat_bloqueado");
            entity.Property(e => e.IdUsuario).HasColumnName("id_usuario");
            entity.Property(e => e.IdUsuarioBloqueado).HasColumnName("id_usuario_bloqueado");
            entity.Property(e => e.FechaBloqueo).HasColumnType("datetime2").HasColumnName("fecha_bloqueo");

            entity.HasOne(e => e.IdUsuarioNavigation)
                .WithMany()
                .HasForeignKey(e => e.IdUsuario)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_usuario_chat_bloqueado_usuario");
            entity.HasOne(e => e.IdUsuarioBloqueadoNavigation)
                .WithMany()
                .HasForeignKey(e => e.IdUsuarioBloqueado)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_usuario_chat_bloqueado_bloqueado");
        });

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
