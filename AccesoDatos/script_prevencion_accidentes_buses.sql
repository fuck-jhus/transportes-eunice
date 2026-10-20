-- ============================================================================
-- SCRIPT DE CREACIÓN DE BASE DE DATOS: PREVENCIÓN DE ACCIDENTES EN AUTOBUSES
-- Motor Compatible: Microsoft SQL Server (SQL Server 2017 / 2019 / 2022 / LocalDB / Express)
-- Base de Datos: prevencion_accidentes_buses
-- Nota: Este script es seguro e idempotente (no destruye datos existentes).
-- ============================================================================

IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'prevencion_accidentes_buses')
BEGIN
    CREATE DATABASE prevencion_accidentes_buses;
END
GO

USE prevencion_accidentes_buses;
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- ============================================================================
-- 1. TABLA: usuario (Gestión de Usuarios, Autenticación y Roles)
-- ============================================================================
IF OBJECT_ID('dbo.usuario', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.usuario (
        id_usuario INT IDENTITY(1,1) NOT NULL,
        nombre_completo VARCHAR(100) NOT NULL,
        usuario_login VARCHAR(50) NOT NULL,
        contrasena VARCHAR(255) NOT NULL,
        tipo_rol VARCHAR(20) NOT NULL,
        estado VARCHAR(10) NOT NULL CONSTRAINT DF_usuario_estado DEFAULT 'Activo',
        CONSTRAINT PK_usuario PRIMARY KEY CLUSTERED (id_usuario),
        CONSTRAINT UQ_usuario_login UNIQUE (usuario_login),
        CONSTRAINT CK_usuario_estado CHECK (estado IN ('Activo', 'Inactivo')),
        CONSTRAINT CK_usuario_tipo_rol CHECK (tipo_rol IN ('Administrador', 'Piloto', 'Supervisor', 'Analista'))
    );
END
GO

-- ============================================================================
-- 2. TABLA: autobus (Flota de Autobuses)
-- ============================================================================
IF OBJECT_ID('dbo.autobus', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.autobus (
        id_autobus INT IDENTITY(1,1) NOT NULL,
        placa VARCHAR(20) NOT NULL,
        marca_modelo VARCHAR(100) NULL,
        estado VARCHAR(15) NOT NULL CONSTRAINT DF_autobus_estado DEFAULT 'Activo',
        CONSTRAINT PK_autobus PRIMARY KEY CLUSTERED (id_autobus),
        CONSTRAINT UQ_autobus_placa UNIQUE (placa),
        CONSTRAINT CK_autobus_estado CHECK (estado IN ('Activo', 'Inactivo', 'En Taller'))
    );
END
GO

-- ============================================================================
-- 3. TABLA: ruta (Catálogo de Rutas de Transporte)
-- ============================================================================
IF OBJECT_ID('dbo.ruta', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ruta (
        id_ruta INT IDENTITY(1,1) NOT NULL,
        nombre_ruta VARCHAR(100) NOT NULL,
        origen VARCHAR(100) NOT NULL,
        destino VARCHAR(100) NOT NULL,
        origen_latitud DECIMAL(10,8) NULL,
        origen_longitud DECIMAL(11,8) NULL,
        destino_latitud DECIMAL(10,8) NULL,
        destino_longitud DECIMAL(11,8) NULL,
        CONSTRAINT PK_ruta PRIMARY KEY CLUSTERED (id_ruta)
    );
END
GO

-- ============================================================================
-- 4. TABLA: viaje_diario (Despacho y Control de Viajes de Autobuses)
-- ============================================================================
IF OBJECT_ID('dbo.viaje_diario', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.viaje_diario (
        id_viaje INT IDENTITY(1,1) NOT NULL,
        id_usuario INT NOT NULL,
        id_autobus INT NOT NULL,
        id_ruta INT NULL,
        fecha_inicio DATETIME NOT NULL,
        fecha_fin DATETIME NULL,
        estado_viaje VARCHAR(15) NOT NULL CONSTRAINT DF_viaje_diario_estado DEFAULT 'En Curso',
        CONSTRAINT PK_viaje_diario PRIMARY KEY CLUSTERED (id_viaje),
        CONSTRAINT FK_viaje_diario_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT FK_viaje_diario_autobus FOREIGN KEY (id_autobus) REFERENCES dbo.autobus (id_autobus),
        CONSTRAINT FK_viaje_diario_ruta FOREIGN KEY (id_ruta) REFERENCES dbo.ruta (id_ruta),
        CONSTRAINT CK_viaje_diario_estado CHECK (estado_viaje IN ('En Curso', 'Finalizado', 'Cancelado'))
    );
END
GO

-- Garantiza a nivel de base de datos que un piloto y un autobús no puedan
-- participar en más de un viaje activo, incluso bajo solicitudes concurrentes.
IF EXISTS (
    SELECT id_usuario FROM dbo.viaje_diario
    WHERE estado_viaje = 'En Curso'
    GROUP BY id_usuario HAVING COUNT(*) > 1
)
    THROW 51001, 'Existen pilotos con más de un viaje activo. Corrija los duplicados antes de continuar.', 1;
GO

IF EXISTS (
    SELECT id_autobus FROM dbo.viaje_diario
    WHERE estado_viaje = 'En Curso'
    GROUP BY id_autobus HAVING COUNT(*) > 1
)
    THROW 51002, 'Existen autobuses con más de un viaje activo. Corrija los duplicados antes de continuar.', 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_viaje_piloto_en_curso' AND object_id = OBJECT_ID('dbo.viaje_diario'))
BEGIN
    CREATE UNIQUE INDEX UX_viaje_piloto_en_curso
        ON dbo.viaje_diario (id_usuario)
        WHERE estado_viaje = 'En Curso';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_viaje_autobus_en_curso' AND object_id = OBJECT_ID('dbo.viaje_diario'))
BEGIN
    CREATE UNIQUE INDEX UX_viaje_autobus_en_curso
        ON dbo.viaje_diario (id_autobus)
        WHERE estado_viaje = 'En Curso';
END
GO

-- ============================================================================
-- 5. TABLA: telemetria_iot (Lecturas de Sensores GPS, Acelerómetro y Giroscopio)
-- ============================================================================
IF OBJECT_ID('dbo.telemetria_iot', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.telemetria_iot (
        id_telemetria BIGINT IDENTITY(1,1) NOT NULL,
        id_viaje INT NOT NULL,
        latitud DECIMAL(10, 8) NOT NULL,
        longitud DECIMAL(11, 8) NOT NULL,
        velocidad_kmh DECIMAL(5, 2) NOT NULL,
        aceleracion_x DECIMAL(5, 2) NULL,
        aceleracion_y DECIMAL(5, 2) NULL,
        aceleracion_z DECIMAL(5, 2) NULL,
        giroscopio_x DECIMAL(5, 2) NULL,
        giroscopio_y DECIMAL(5, 2) NULL,
        giroscopio_z DECIMAL(5, 2) NULL,
        fecha_hora_dispositivo DATETIME NOT NULL,
        fecha_hora_servidor DATETIME NOT NULL CONSTRAINT DF_telemetria_servidor DEFAULT GETUTCDATE(),
        CONSTRAINT PK_telemetria_iot PRIMARY KEY CLUSTERED (id_telemetria),
        CONSTRAINT FK_telemetria_iot_viaje FOREIGN KEY (id_viaje) REFERENCES dbo.viaje_diario (id_viaje)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_viaje_telemetria' AND object_id = OBJECT_ID('dbo.telemetria_iot'))
BEGIN
    CREATE INDEX idx_viaje_telemetria ON dbo.telemetria_iot (id_viaje);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_fecha_dispositivo' AND object_id = OBJECT_ID('dbo.telemetria_iot'))
BEGIN
    CREATE INDEX idx_fecha_dispositivo ON dbo.telemetria_iot (fecha_hora_dispositivo);
END
GO

-- ============================================================================
-- 6. TABLA: alerta_riesgo (Infracciones y Eventos Peligrosos Detectados)
-- ============================================================================
IF OBJECT_ID('dbo.alerta_riesgo', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.alerta_riesgo (
        id_alerta BIGINT IDENTITY(1,1) NOT NULL,
        id_telemetria BIGINT NOT NULL,
        id_viaje INT NOT NULL,
        tipo_alerta VARCHAR(30) NOT NULL,
        valor_registrado DECIMAL(5, 2) NOT NULL,
        limite_permitido DECIMAL(5, 2) NULL,
        fecha_hora DATETIME NOT NULL,
        CONSTRAINT PK_alerta_riesgo PRIMARY KEY CLUSTERED (id_alerta),
        CONSTRAINT FK_alerta_riesgo_telemetria FOREIGN KEY (id_telemetria) REFERENCES dbo.telemetria_iot (id_telemetria),
        CONSTRAINT FK_alerta_riesgo_viaje FOREIGN KEY (id_viaje) REFERENCES dbo.viaje_diario (id_viaje),
        CONSTRAINT CK_alerta_riesgo_tipo CHECK (tipo_alerta IN ('Giro Brusco', 'Aceleración Peligrosa', 'Frenado Brusco', 'Exceso de Velocidad'))
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_tipo_alerta' AND object_id = OBJECT_ID('dbo.alerta_riesgo'))
BEGIN
    CREATE INDEX idx_tipo_alerta ON dbo.alerta_riesgo (tipo_alerta);
END
GO

-- ============================================================================
-- 7. TABLA: evaluacion_piloto_mensual (Consolidado y Calificación Mensual)
-- Nota: mes_anio es de tipo DATE (primer día del mes 'YYYY-MM-01')
-- ============================================================================
IF OBJECT_ID('dbo.evaluacion_piloto_mensual', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.evaluacion_piloto_mensual (
        id_evaluacion INT IDENTITY(1,1) NOT NULL,
        id_usuario INT NOT NULL,
        mes_anio DATE NOT NULL, -- Fecha (YYYY-MM-01) compatible con DateOnly de C#
        total_viajes INT NOT NULL CONSTRAINT DF_eval_total_viajes DEFAULT 0,
        alertas_velocidad INT NOT NULL CONSTRAINT DF_eval_alertas_vel DEFAULT 0,
        alertas_frenado INT NOT NULL CONSTRAINT DF_eval_alertas_fren DEFAULT 0,
        alertas_maniobras INT NOT NULL CONSTRAINT DF_eval_alertas_man DEFAULT 0,
        horas_conduccion DECIMAL(10,2) NOT NULL CONSTRAINT DF_eval_horas_conduccion DEFAULT 0,
        puntos_riesgo_por_10h DECIMAL(10,2) NOT NULL CONSTRAINT DF_eval_puntos_riesgo DEFAULT 0,
        calificacion_desempeno DECIMAL(5, 2) NOT NULL CONSTRAINT DF_eval_calificacion DEFAULT 100.00,
        CONSTRAINT PK_evaluacion_piloto_mensual PRIMARY KEY CLUSTERED (id_evaluacion),
        CONSTRAINT FK_evaluacion_piloto_usuario FOREIGN KEY (id_usuario) REFERENCES dbo.usuario (id_usuario),
        CONSTRAINT unq_piloto_mes UNIQUE (id_usuario, mes_anio)
    );
END
GO

IF COL_LENGTH('dbo.evaluacion_piloto_mensual', 'horas_conduccion') IS NULL
BEGIN
    ALTER TABLE dbo.evaluacion_piloto_mensual
        ADD horas_conduccion DECIMAL(10,2) NOT NULL CONSTRAINT DF_eval_horas_conduccion DEFAULT 0;
END
GO

IF COL_LENGTH('dbo.evaluacion_piloto_mensual', 'puntos_riesgo_por_10h') IS NULL
BEGIN
    ALTER TABLE dbo.evaluacion_piloto_mensual
        ADD puntos_riesgo_por_10h DECIMAL(10,2) NOT NULL CONSTRAINT DF_eval_puntos_riesgo DEFAULT 0;
END
GO

-- ============================================================================
-- 8. TABLA: mensaje_chat (Historial persistente y eliminación lógica)
-- ============================================================================
IF OBJECT_ID('dbo.mensaje_chat', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.mensaje_chat (
        id_mensaje UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_mensaje_chat_id DEFAULT NEWSEQUENTIALID(),
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
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_mensaje_chat_canal_fecha' AND object_id = OBJECT_ID('dbo.mensaje_chat'))
BEGIN
    CREATE INDEX idx_mensaje_chat_canal_fecha
        ON dbo.mensaje_chat (id_piloto_canal, fecha_hora DESC)
        INCLUDE (eliminado);
END
GO

PRINT '--> Verificación e inicialización de esquema completada exitosamente.';
