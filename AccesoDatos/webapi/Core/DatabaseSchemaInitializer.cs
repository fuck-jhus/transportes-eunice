using AccesoDatos.Context;
using Microsoft.EntityFrameworkCore;

namespace webapi.Core;

public static class DatabaseSchemaInitializer
{
    public static async Task ValidateAsync(PrevencionAccidentesBusesContext context)
    {
        if (!context.Database.IsRelational()) return;
        var missing = await context.Database.SqlQueryRaw<int>("""
            SELECT CASE WHEN COL_LENGTH('dbo.telemetria_iot','hash_lectura') IS NULL
              OR COL_LENGTH('dbo.viaje_diario','id_operacion') IS NULL
              OR COL_LENGTH('dbo.viaje_diario','version') IS NULL
              OR COL_LENGTH('dbo.viaje_diario','revision_destino') IS NULL
              OR COL_LENGTH('dbo.usuario','version') IS NULL
              OR COL_LENGTH('dbo.autobus','version') IS NULL
              OR COL_LENGTH('dbo.viaje_acceso_publico','token_protegido') IS NULL
              OR COL_LENGTH('dbo.evaluacion_piloto_mensual','calidad_datos') IS NULL
              OR COL_LENGTH('dbo.ruta','nombre_ruta_normalizada') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','id_dispositivo') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','id_usuario') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','expo_push_token') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','plataforma') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','device_id') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','activo') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','fecha_registro') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','fecha_ultimo_uso') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','registration_id') IS NULL
              OR COL_LENGTH('dbo.dispositivo_push','binding_changed_at') IS NULL
              OR COL_LENGTH('dbo.push_outbox_message','EventKey') IS NULL
              OR COL_LENGTH('dbo.push_outbox_message','DataJson') IS NULL
              OR COL_LENGTH('dbo.push_outbox_message','ExpandedAt') IS NULL
              OR COL_LENGTH('dbo.push_outbox_delivery','TicketId') IS NULL
              OR COL_LENGTH('dbo.push_outbox_delivery','RegistrationId') IS NULL
              OR COL_LENGTH('dbo.push_outbox_delivery','LeaseUntil') IS NULL
              OR COL_LENGTH('dbo.tracking_notification_state','LostAt') IS NULL
              OR COL_LENGTH('dbo.guest_push_subscription','ProtectedUrl') IS NULL
              OR COL_LENGTH('dbo.guest_push_job','LeaseUntil') IS NULL
              OR COL_LENGTH('dbo.guest_push_keys','ProtectedPrivateKey') IS NULL
              OR COL_LENGTH('dbo.push_notification_marker','EventKey') IS NULL
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.push_outbox_message') AND name='UX_push_outbox_event' AND is_unique=1 AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.push_outbox_delivery') AND name='UX_push_delivery_device' AND is_unique=1 AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.push_outbox_delivery') AND name='IX_push_delivery_due' AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.guest_push_job') AND name='IX_guest_push_due' AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.dispositivo_push') AND name='UX_dispositivo_push_token' AND is_unique=1 AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.dispositivo_push') AND name='idx_dispositivo_push_usuario_activo' AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.telemetria_iot') AND name='UX_telemetria_lectura' AND is_unique=1 AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.viaje_diario') AND name='UX_viaje_operacion' AND is_unique=1 AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.viaje_diario') AND name='UX_viaje_piloto_en_curso' AND is_unique=1 AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.viaje_diario') AND name='UX_viaje_autobus_en_curso' AND is_unique=1 AND is_disabled=0)
              OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.ruta') AND name='UX_ruta_nombre_normalizado' AND is_unique=1 AND is_disabled=0)
              THEN 1 ELSE 0 END AS [Value]
            """).SingleAsync();
        if (missing != 0) throw new InvalidOperationException("Faltan migraciones SQL 20261016_integridad.sql / 20261017_push_operations.sql. Aplícalas con el servicio detenido y una cuenta de migración; la cuenta de ejecución no necesita DDL.");
    }

    public static async Task ApplyAsync(
        PrevencionAccidentesBusesContext context,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        if (!context.Database.IsRelational())
        {
            return;
        }

        const string sql = """
            SET QUOTED_IDENTIFIER ON;
            SET ANSI_NULLS ON;
            SET ANSI_PADDING ON;
            SET ANSI_WARNINGS ON;
            SET ARITHABORT ON;
            SET CONCAT_NULL_YIELDS_NULL ON;
            SET NUMERIC_ROUNDABORT OFF;

            IF EXISTS (
                SELECT id_usuario
                FROM dbo.viaje_diario
                WHERE estado_viaje = 'En Curso'
                GROUP BY id_usuario
                HAVING COUNT(*) > 1
            )
                THROW 51001, 'No se puede crear el índice de viajes: hay pilotos con más de un viaje activo.', 1;

            IF EXISTS (
                SELECT id_autobus
                FROM dbo.viaje_diario
                WHERE estado_viaje = 'En Curso'
                GROUP BY id_autobus
                HAVING COUNT(*) > 1
            )
                THROW 51002, 'No se puede crear el índice de viajes: hay autobuses con más de un viaje activo.', 1;

            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'UX_viaje_piloto_en_curso'
                  AND object_id = OBJECT_ID('dbo.viaje_diario')
            )
                CREATE UNIQUE INDEX UX_viaje_piloto_en_curso
                    ON dbo.viaje_diario (id_usuario)
                    WHERE estado_viaje = 'En Curso';

            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'UX_viaje_autobus_en_curso'
                  AND object_id = OBJECT_ID('dbo.viaje_diario')
            )
                CREATE UNIQUE INDEX UX_viaje_autobus_en_curso
                    ON dbo.viaje_diario (id_autobus)
                    WHERE estado_viaje = 'En Curso';

            IF OBJECT_ID('dbo.mensaje_chat', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.mensaje_chat (
                    id_mensaje UNIQUEIDENTIFIER NOT NULL
                        CONSTRAINT DF_mensaje_chat_id DEFAULT NEWSEQUENTIALID(),
                    id_emisor INT NOT NULL,
                    nombre_emisor VARCHAR(100) NOT NULL,
                    rol_emisor VARCHAR(20) NOT NULL,
                    id_piloto_canal INT NOT NULL CONSTRAINT DF_mensaje_chat_canal DEFAULT 0,
                    nombre_piloto_canal VARCHAR(100) NOT NULL,
                    contenido NVARCHAR(2000) NOT NULL,
                    tipo_contenido VARCHAR(20) NOT NULL CONSTRAINT DF_mensaje_chat_tipo DEFAULT 'texto',
                    fecha_hora DATETIME2 NOT NULL CONSTRAINT DF_mensaje_chat_fecha DEFAULT SYSUTCDATETIME(),
                    eliminado BIT NOT NULL CONSTRAINT DF_mensaje_chat_eliminado DEFAULT 0,
                    fecha_eliminacion DATETIME2 NULL,
                    id_eliminado_por INT NULL,
                    CONSTRAINT PK_mensaje_chat PRIMARY KEY CLUSTERED (id_mensaje),
                    CONSTRAINT FK_mensaje_chat_emisor FOREIGN KEY (id_emisor) REFERENCES dbo.usuario (id_usuario),
                    CONSTRAINT FK_mensaje_chat_eliminado_por FOREIGN KEY (id_eliminado_por) REFERENCES dbo.usuario (id_usuario),
                    CONSTRAINT CK_mensaje_chat_tipo CHECK (tipo_contenido IN ('texto', 'alerta', 'indicacion')),
                    CONSTRAINT CK_mensaje_chat_canal CHECK (id_piloto_canal >= 0)
                );
            END;

            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'idx_mensaje_chat_canal_fecha'
                  AND object_id = OBJECT_ID('dbo.mensaje_chat')
            )
                CREATE INDEX idx_mensaje_chat_canal_fecha
                    ON dbo.mensaje_chat (id_piloto_canal, fecha_hora DESC)
                    INCLUDE (eliminado);

            IF COL_LENGTH('dbo.viaje_diario', 'destino_latitud') IS NULL
                ALTER TABLE dbo.viaje_diario ADD destino_latitud DECIMAL(10,8) NULL;

            IF COL_LENGTH('dbo.viaje_diario', 'destino_longitud') IS NULL
                ALTER TABLE dbo.viaje_diario ADD destino_longitud DECIMAL(11,8) NULL;

            IF COL_LENGTH('dbo.viaje_diario', 'destino_nombre') IS NULL
                ALTER TABLE dbo.viaje_diario ADD destino_nombre NVARCHAR(150) NULL;

            IF COL_LENGTH('dbo.viaje_diario', 'navegacion_actualizada') IS NULL
                ALTER TABLE dbo.viaje_diario ADD navegacion_actualizada DATETIME2 NULL;

            IF COL_LENGTH('dbo.viaje_diario', 'modo_privacidad') IS NULL
                ALTER TABLE dbo.viaje_diario ADD modo_privacidad BIT NOT NULL
                    CONSTRAINT DF_viaje_modo_privacidad DEFAULT 0;

            IF COL_LENGTH('dbo.ruta', 'origen_latitud') IS NULL
                ALTER TABLE dbo.ruta ADD origen_latitud DECIMAL(10,8) NULL;

            IF COL_LENGTH('dbo.ruta', 'origen_longitud') IS NULL
                ALTER TABLE dbo.ruta ADD origen_longitud DECIMAL(11,8) NULL;

            IF COL_LENGTH('dbo.ruta', 'destino_latitud') IS NULL
                ALTER TABLE dbo.ruta ADD destino_latitud DECIMAL(10,8) NULL;

            IF COL_LENGTH('dbo.ruta', 'destino_longitud') IS NULL
                ALTER TABLE dbo.ruta ADD destino_longitud DECIMAL(11,8) NULL;

            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'idx_telemetria_viaje_fecha'
                  AND object_id = OBJECT_ID('dbo.telemetria_iot')
            )
                CREATE INDEX idx_telemetria_viaje_fecha
                    ON dbo.telemetria_iot (id_viaje, fecha_hora_dispositivo DESC)
                    INCLUDE (latitud, longitud, velocidad_kmh, fecha_hora_servidor);

            IF OBJECT_ID('dbo.viaje_acceso_publico', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.viaje_acceso_publico (
                    id_acceso UNIQUEIDENTIFIER NOT NULL
                        CONSTRAINT DF_viaje_acceso_id DEFAULT NEWSEQUENTIALID(),
                    id_viaje INT NOT NULL,
                    token_hash CHAR(64) NOT NULL,
                    fecha_creacion DATETIME2 NOT NULL
                        CONSTRAINT DF_viaje_acceso_creacion DEFAULT SYSUTCDATETIME(),
                    fecha_expiracion DATETIME2 NOT NULL,
                    fecha_revocacion DATETIME2 NULL,
                    chat_habilitado BIT NOT NULL
                        CONSTRAINT DF_viaje_acceso_chat DEFAULT 1,
                    id_creado_por INT NULL,
                    CONSTRAINT PK_viaje_acceso_publico PRIMARY KEY CLUSTERED (id_acceso),
                    CONSTRAINT FK_viaje_acceso_viaje FOREIGN KEY (id_viaje)
                        REFERENCES dbo.viaje_diario (id_viaje) ON DELETE CASCADE,
                    CONSTRAINT FK_viaje_acceso_creador FOREIGN KEY (id_creado_por)
                        REFERENCES dbo.usuario (id_usuario)
                );
                CREATE UNIQUE INDEX UX_viaje_acceso_token
                    ON dbo.viaje_acceso_publico (token_hash);
                CREATE INDEX idx_viaje_acceso_estado
                    ON dbo.viaje_acceso_publico (id_viaje, fecha_revocacion)
                    INCLUDE (fecha_expiracion, chat_habilitado);
            END;

            IF OBJECT_ID('dbo.conversacion_pasajero', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.conversacion_pasajero (
                    id_conversacion UNIQUEIDENTIFIER NOT NULL
                        CONSTRAINT DF_conversacion_pasajero_id DEFAULT NEWSEQUENTIALID(),
                    id_acceso UNIQUEIDENTIFIER NOT NULL,
                    sesion_hash CHAR(64) NOT NULL,
                    alias_pasajero NVARCHAR(60) NOT NULL,
                    fecha_creacion DATETIME2 NOT NULL
                        CONSTRAINT DF_conversacion_pasajero_creacion DEFAULT SYSUTCDATETIME(),
                    fecha_ultima_actividad DATETIME2 NOT NULL
                        CONSTRAINT DF_conversacion_pasajero_actividad DEFAULT SYSUTCDATETIME(),
                    bloqueada BIT NOT NULL
                        CONSTRAINT DF_conversacion_pasajero_bloqueada DEFAULT 0,
                    fecha_lectura_operador DATETIME2 NULL,
                    fecha_lectura_pasajero DATETIME2 NULL,
                    CONSTRAINT PK_conversacion_pasajero PRIMARY KEY CLUSTERED (id_conversacion),
                    CONSTRAINT FK_conversacion_acceso FOREIGN KEY (id_acceso)
                        REFERENCES dbo.viaje_acceso_publico (id_acceso) ON DELETE CASCADE
                );
                CREATE UNIQUE INDEX UX_conversacion_acceso_sesion
                    ON dbo.conversacion_pasajero (id_acceso, sesion_hash);
                CREATE INDEX idx_conversacion_actividad
                    ON dbo.conversacion_pasajero (id_acceso, fecha_ultima_actividad DESC)
                    INCLUDE (bloqueada, alias_pasajero);
            END;

            IF OBJECT_ID('dbo.mensaje_pasajero', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.mensaje_pasajero (
                    id_mensaje UNIQUEIDENTIFIER NOT NULL
                        CONSTRAINT DF_mensaje_pasajero_id DEFAULT NEWSEQUENTIALID(),
                    id_conversacion UNIQUEIDENTIFIER NOT NULL,
                    tipo_emisor VARCHAR(12) NOT NULL,
                    id_usuario_emisor INT NULL,
                    nombre_emisor NVARCHAR(100) NOT NULL,
                    contenido NVARCHAR(500) NOT NULL,
                    id_cliente VARCHAR(64) NULL,
                    fecha_hora DATETIME2 NOT NULL
                        CONSTRAINT DF_mensaje_pasajero_fecha DEFAULT SYSUTCDATETIME(),
                    fecha_entrega DATETIME2 NULL,
                    fecha_lectura DATETIME2 NULL,
                    CONSTRAINT PK_mensaje_pasajero PRIMARY KEY CLUSTERED (id_mensaje),
                    CONSTRAINT FK_mensaje_pasajero_conversacion FOREIGN KEY (id_conversacion)
                        REFERENCES dbo.conversacion_pasajero (id_conversacion) ON DELETE CASCADE,
                    CONSTRAINT FK_mensaje_pasajero_usuario FOREIGN KEY (id_usuario_emisor)
                        REFERENCES dbo.usuario (id_usuario),
                    CONSTRAINT CK_mensaje_pasajero_emisor
                        CHECK (tipo_emisor IN ('Pasajero', 'Piloto', 'Operador'))
                );
                CREATE INDEX idx_mensaje_pasajero_fecha
                    ON dbo.mensaje_pasajero (id_conversacion, fecha_hora);
                CREATE UNIQUE INDEX UX_mensaje_pasajero_cliente
                    ON dbo.mensaje_pasajero (id_conversacion, id_cliente)
                    WHERE id_cliente IS NOT NULL;
            END;

            IF OBJECT_ID('dbo.reporte_contenido', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.reporte_contenido (
                    id_reporte UNIQUEIDENTIFIER NOT NULL
                        CONSTRAINT DF_reporte_contenido_id DEFAULT NEWSEQUENTIALID(),
                    tipo_contenido VARCHAR(20) NOT NULL,
                    id_mensaje UNIQUEIDENTIFIER NOT NULL,
                    id_conversacion UNIQUEIDENTIFIER NULL,
                    id_reportante INT NOT NULL,
                    id_usuario_reportado INT NULL,
                    alias_reportado NVARCHAR(100) NOT NULL,
                    motivo NVARCHAR(80) NOT NULL,
                    detalle NVARCHAR(500) NULL,
                    estado VARCHAR(20) NOT NULL
                        CONSTRAINT DF_reporte_contenido_estado DEFAULT 'Pendiente',
                    fecha_reporte DATETIME2 NOT NULL
                        CONSTRAINT DF_reporte_contenido_fecha DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT PK_reporte_contenido PRIMARY KEY CLUSTERED (id_reporte),
                    CONSTRAINT FK_reporte_contenido_reportante FOREIGN KEY (id_reportante)
                        REFERENCES dbo.usuario (id_usuario),
                    CONSTRAINT CK_reporte_contenido_tipo
                        CHECK (tipo_contenido IN ('ChatOperativo', 'ChatPasajero')),
                    CONSTRAINT CK_reporte_contenido_estado
                        CHECK (estado IN ('Pendiente', 'Revisado', 'Descartado'))
                );
                CREATE UNIQUE INDEX UX_reporte_contenido_unico
                    ON dbo.reporte_contenido (id_reportante, tipo_contenido, id_mensaje);
                CREATE INDEX idx_reporte_contenido_estado
                    ON dbo.reporte_contenido (estado, fecha_reporte DESC);
            END;

            IF OBJECT_ID('dbo.usuario_chat_bloqueado', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.usuario_chat_bloqueado (
                    id_usuario INT NOT NULL,
                    id_usuario_bloqueado INT NOT NULL,
                    fecha_bloqueo DATETIME2 NOT NULL
                        CONSTRAINT DF_usuario_chat_bloqueado_fecha DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT PK_usuario_chat_bloqueado PRIMARY KEY CLUSTERED (id_usuario, id_usuario_bloqueado),
                    CONSTRAINT FK_usuario_chat_bloqueado_usuario FOREIGN KEY (id_usuario)
                        REFERENCES dbo.usuario (id_usuario) ON DELETE CASCADE,
                    CONSTRAINT FK_usuario_chat_bloqueado_bloqueado FOREIGN KEY (id_usuario_bloqueado)
                        REFERENCES dbo.usuario (id_usuario),
                    CONSTRAINT CK_usuario_chat_bloqueado_distinto
                        CHECK (id_usuario <> id_usuario_bloqueado)
                );
                CREATE INDEX idx_usuario_chat_bloqueado_objetivo
                    ON dbo.usuario_chat_bloqueado (id_usuario_bloqueado);
            END;

            IF COL_LENGTH('dbo.evaluacion_piloto_mensual', 'horas_conduccion') IS NULL
                ALTER TABLE dbo.evaluacion_piloto_mensual
                    ADD horas_conduccion DECIMAL(10,2) NOT NULL
                        CONSTRAINT DF_eval_horas_conduccion DEFAULT 0;

            IF COL_LENGTH('dbo.evaluacion_piloto_mensual', 'puntos_riesgo_por_10h') IS NULL
                ALTER TABLE dbo.evaluacion_piloto_mensual
                    ADD puntos_riesgo_por_10h DECIMAL(10,2) NOT NULL
                        CONSTRAINT DF_eval_puntos_riesgo DEFAULT 0;

            IF OBJECT_ID('dbo.dispositivo_push', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.dispositivo_push (
                    id_dispositivo INT IDENTITY(1,1) NOT NULL,
                    id_usuario INT NOT NULL,
                    expo_push_token VARCHAR(200) NOT NULL,
                    plataforma VARCHAR(20) NOT NULL,
                    device_id VARCHAR(120) NULL,
                    activo BIT NOT NULL CONSTRAINT DF_dispositivo_push_activo DEFAULT 1,
                    fecha_registro DATETIME2 NOT NULL CONSTRAINT DF_dispositivo_push_registro DEFAULT SYSUTCDATETIME(),
                    fecha_ultimo_uso DATETIME2 NOT NULL CONSTRAINT DF_dispositivo_push_uso DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT PK_dispositivo_push PRIMARY KEY CLUSTERED (id_dispositivo),
                    CONSTRAINT FK_dispositivo_push_usuario FOREIGN KEY (id_usuario)
                        REFERENCES dbo.usuario (id_usuario) ON DELETE CASCADE
                );
            END;

            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'UX_dispositivo_push_token'
                  AND object_id = OBJECT_ID('dbo.dispositivo_push')
            )
                CREATE UNIQUE INDEX UX_dispositivo_push_token
                    ON dbo.dispositivo_push (expo_push_token);

            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'idx_dispositivo_push_usuario_activo'
                  AND object_id = OBJECT_ID('dbo.dispositivo_push')
            )
                CREATE INDEX idx_dispositivo_push_usuario_activo
                    ON dbo.dispositivo_push (id_usuario, activo)
                    INCLUDE (expo_push_token, plataforma, fecha_ultimo_uso);
            """;

        await context.Database.ExecuteSqlRawAsync(sql, cancellationToken);
        using var migration = typeof(DatabaseSchemaInitializer).Assembly.GetManifestResourceStream("webapi.Sql.20261016_integridad.sql")
            ?? throw new InvalidOperationException("Falta la migración de integridad.");
        using var reader = new StreamReader(migration);
        await context.Database.ExecuteSqlRawAsync(await reader.ReadToEndAsync(cancellationToken), cancellationToken);
        using var pushMigration = typeof(DatabaseSchemaInitializer).Assembly.GetManifestResourceStream("webapi.Sql.20261017_push_operations.sql")
            ?? throw new InvalidOperationException("Falta la migración de notificaciones.");
        using var pushReader = new StreamReader(pushMigration);
        await context.Database.ExecuteSqlRawAsync(await pushReader.ReadToEndAsync(cancellationToken), cancellationToken);
        logger.LogInformation("Esquema de base de datos verificado y actualizado.");
    }
}
