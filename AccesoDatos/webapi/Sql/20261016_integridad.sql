-- Additive migration. Back up first. No historical readings/messages are deleted.
-- Run with the API stopped and a migration principal, never the runtime principal.
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource='eunice-schema-20261016',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;
IF @lock < 0 THROW 51011,'No se pudo bloquear la migración.',1;
-- Production starts with schema validation only. Provision push explicitly here too,
-- including databases that predate device registration; never rely on runtime DDL.
IF OBJECT_ID('dbo.dispositivo_push','U') IS NULL
BEGIN
 CREATE TABLE dbo.dispositivo_push (
  id_dispositivo int IDENTITY(1,1) NOT NULL CONSTRAINT PK_dispositivo_push PRIMARY KEY CLUSTERED,
  id_usuario int NOT NULL,
  expo_push_token varchar(200) NOT NULL,
  plataforma varchar(20) NOT NULL,
  device_id varchar(120) NULL,
  activo bit NOT NULL CONSTRAINT DF_dispositivo_push_activo DEFAULT 1,
  fecha_registro datetime2 NOT NULL CONSTRAINT DF_dispositivo_push_registro DEFAULT SYSUTCDATETIME(),
  fecha_ultimo_uso datetime2 NOT NULL CONSTRAINT DF_dispositivo_push_uso DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_dispositivo_push_usuario FOREIGN KEY(id_usuario) REFERENCES dbo.usuario(id_usuario) ON DELETE CASCADE
 );
END;
IF COL_LENGTH('dbo.dispositivo_push','device_id') IS NULL
 ALTER TABLE dbo.dispositivo_push ADD device_id varchar(120) NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.dispositivo_push') AND name='UX_dispositivo_push_token')
 CREATE UNIQUE INDEX UX_dispositivo_push_token ON dbo.dispositivo_push(expo_push_token);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.dispositivo_push') AND name='idx_dispositivo_push_usuario_activo')
 EXEC(N'CREATE INDEX idx_dispositivo_push_usuario_activo ON dbo.dispositivo_push(id_usuario,activo)
 INCLUDE(expo_push_token,plataforma,fecha_ultimo_uso)');
IF EXISTS(SELECT id_usuario FROM dbo.viaje_diario WHERE estado_viaje='En Curso' GROUP BY id_usuario HAVING COUNT(*)>1)
 OR EXISTS(SELECT id_autobus FROM dbo.viaje_diario WHERE estado_viaje='En Curso' GROUP BY id_autobus HAVING COUNT(*)>1)
 THROW 51012,'Hay asignaciones activas duplicadas: corregir manualmente antes de migrar.',1;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.viaje_diario') AND name='UX_viaje_piloto_en_curso')
 CREATE UNIQUE INDEX UX_viaje_piloto_en_curso ON dbo.viaje_diario(id_usuario) WHERE estado_viaje='En Curso';
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.viaje_diario') AND name='UX_viaje_autobus_en_curso')
 CREATE UNIQUE INDEX UX_viaje_autobus_en_curso ON dbo.viaje_diario(id_autobus) WHERE estado_viaje='En Curso';
IF COL_LENGTH('dbo.telemetria_iot','id_lectura') IS NULL
 ALTER TABLE dbo.telemetria_iot ADD id_lectura varchar(100) COLLATE Latin1_General_100_BIN2 NULL, id_fuente varchar(100) NULL,
 sensores_calibrados bit NOT NULL CONSTRAINT DF_telemetria_calibrada DEFAULT 0, precision_metros decimal(10,2) NULL;
IF COL_LENGTH('dbo.telemetria_iot','hash_lectura') IS NULL ALTER TABLE dbo.telemetria_iot ADD hash_lectura varchar(64) NULL;
-- Preserve old precision and history. New observations use datetime2; old rows remain NULL-id legacy rows.
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.telemetria_iot') AND name='fecha_hora_dispositivo' AND TYPE_NAME(system_type_id)='datetime')
BEGIN
 IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.telemetria_iot') AND name='idx_fecha_dispositivo') DROP INDEX idx_fecha_dispositivo ON dbo.telemetria_iot;
 IF EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.telemetria_iot') AND name='idx_telemetria_viaje_fecha') DROP INDEX idx_telemetria_viaje_fecha ON dbo.telemetria_iot;
 ALTER TABLE dbo.telemetria_iot ALTER COLUMN fecha_hora_dispositivo datetime2(7) NOT NULL;
 CREATE INDEX idx_fecha_dispositivo ON dbo.telemetria_iot(fecha_hora_dispositivo);
 CREATE INDEX idx_telemetria_viaje_fecha ON dbo.telemetria_iot(id_viaje,fecha_hora_dispositivo);
END;
-- Legacy databases have a DEFAULT (including DF_telemetria_servidor) on this
-- datetime column. Keep its exact name/expression while changing the type.
-- Avoid touching dependencies again when the target definition is already set.
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.telemetria_iot')
 AND name='fecha_hora_servidor'
 AND (system_type_id<>TYPE_ID(N'datetime2') OR scale<>7 OR is_nullable<>1))
BEGIN
 DECLARE @telemetriaServidorDefaultName sysname,
         @telemetriaServidorDefaultDefinition nvarchar(max),
         @telemetriaServidorSql nvarchar(max);
 SELECT @telemetriaServidorDefaultName=d.name,
        @telemetriaServidorDefaultDefinition=d.definition
 FROM sys.default_constraints d
 JOIN sys.columns c ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id
 WHERE d.parent_object_id=OBJECT_ID(N'dbo.telemetria_iot') AND c.name=N'fecha_hora_servidor';
 IF @telemetriaServidorDefaultName IS NOT NULL
 BEGIN
  SET @telemetriaServidorSql=N'ALTER TABLE dbo.telemetria_iot DROP CONSTRAINT '
      +QUOTENAME(@telemetriaServidorDefaultName)+N';';
  EXEC sys.sp_executesql @telemetriaServidorSql;
 END;
 EXEC(N'ALTER TABLE dbo.telemetria_iot ALTER COLUMN fecha_hora_servidor datetime2(7) NULL;');
 IF @telemetriaServidorDefaultName IS NOT NULL
 BEGIN
  SET @telemetriaServidorSql=N'ALTER TABLE dbo.telemetria_iot ADD CONSTRAINT '
      +QUOTENAME(@telemetriaServidorDefaultName)+N' DEFAULT '
      +@telemetriaServidorDefaultDefinition+N' FOR fecha_hora_servidor;';
  EXEC sys.sp_executesql @telemetriaServidorSql;
 END;
END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.telemetria_iot') AND name='UX_telemetria_lectura')
 EXEC('CREATE UNIQUE INDEX UX_telemetria_lectura ON dbo.telemetria_iot(id_viaje,id_lectura) WHERE id_lectura IS NOT NULL');
IF COL_LENGTH('dbo.viaje_diario','version') IS NULL ALTER TABLE dbo.viaje_diario ADD version rowversion;
IF COL_LENGTH('dbo.viaje_diario','revision_destino') IS NULL ALTER TABLE dbo.viaje_diario ADD revision_destino int NOT NULL CONSTRAINT DF_viaje_revision_destino DEFAULT 0;
IF COL_LENGTH('dbo.viaje_diario','id_operacion') IS NULL ALTER TABLE dbo.viaje_diario ADD id_operacion uniqueidentifier NULL, hash_operacion varchar(100) NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.viaje_diario') AND name='UX_viaje_operacion')
 EXEC('CREATE UNIQUE INDEX UX_viaje_operacion ON dbo.viaje_diario(id_operacion) WHERE id_operacion IS NOT NULL');
IF COL_LENGTH('dbo.autobus','version') IS NULL ALTER TABLE dbo.autobus ADD version rowversion;
IF COL_LENGTH('dbo.usuario','version') IS NULL ALTER TABLE dbo.usuario ADD version rowversion;
IF COL_LENGTH('dbo.viaje_diario','motivo_finalizacion') IS NULL
 ALTER TABLE dbo.viaje_diario ADD motivo_finalizacion nvarchar(100) NULL, nombre_piloto_snapshot nvarchar(100) NULL,
 placa_snapshot nvarchar(20) NULL, nombre_ruta_snapshot nvarchar(150) NULL, origen_snapshot nvarchar(150) NULL,
 destino_snapshot nvarchar(150) NULL, snapshot_historico_estimado bit NOT NULL CONSTRAINT DF_viaje_snapshot_estimado DEFAULT 1,
 id_fuente_rastreo varchar(100) NULL, fuente_rastreo_expira datetime2(7) NULL;
EXEC('UPDATE dbo.viaje_diario SET modo_privacidad=1,id_fuente_rastreo=NULL,fuente_rastreo_expira=NULL WHERE estado_viaje=''Finalizado'';
 UPDATE a SET chat_habilitado=0, fecha_expiracion=CASE
 WHEN a.fecha_expiracion < COALESCE(DATEADD(minute,30,v.fecha_fin),SYSUTCDATETIME()) THEN a.fecha_expiracion
 ELSE COALESCE(DATEADD(minute,30,v.fecha_fin),SYSUTCDATETIME()) END
 FROM dbo.viaje_acceso_publico a JOIN dbo.viaje_diario v ON v.id_viaje=a.id_viaje WHERE v.estado_viaje=''Finalizado''');
EXEC('UPDATE v SET nombre_piloto_snapshot=u.nombre_completo, placa_snapshot=b.placa,
 nombre_ruta_snapshot=r.nombre_ruta, origen_snapshot=r.origen, destino_snapshot=COALESCE(v.destino_nombre,r.destino)
 FROM dbo.viaje_diario v JOIN dbo.usuario u ON u.id_usuario=v.id_usuario JOIN dbo.autobus b ON b.id_autobus=v.id_autobus
 LEFT JOIN dbo.ruta r ON r.id_ruta=v.id_ruta WHERE v.nombre_piloto_snapshot IS NULL');
IF COL_LENGTH('dbo.alerta_riesgo','version_regla') IS NULL
 ALTER TABLE dbo.alerta_riesgo ADD fecha_recepcion datetime2(7) NULL,fecha_ultima_observacion datetime2(7) NULL,
 version_regla varchar(30) NOT NULL CONSTRAINT DF_alerta_version DEFAULT 'legacy';
ALTER TABLE dbo.alerta_riesgo ALTER COLUMN fecha_hora datetime2(7) NOT NULL;
-- Historical alert times cannot be reconstructed reliably: retain them and identify as legacy.
IF COL_LENGTH('dbo.evaluacion_piloto_mensual','version_regla') IS NULL
 ALTER TABLE dbo.evaluacion_piloto_mensual ADD cobertura_porcentaje decimal(5,2) NOT NULL CONSTRAINT DF_eval_cobertura DEFAULT 0,
 version_regla varchar(30) NOT NULL CONSTRAINT DF_eval_version DEFAULT 'legacy', calidad_datos nvarchar(150) NULL;
IF COL_LENGTH('dbo.viaje_acceso_publico','token_protegido') IS NULL ALTER TABLE dbo.viaje_acceso_publico ADD token_protegido nvarchar(max) NULL;
IF EXISTS(SELECT UPPER(LTRIM(RTRIM(nombre_ruta))) FROM dbo.ruta GROUP BY UPPER(LTRIM(RTRIM(nombre_ruta))) HAVING COUNT(*)>1)
 THROW 51013,'Hay nombres de ruta equivalentes. Revisar manualmente; no se elimina ninguna ruta.',1;
IF COL_LENGTH('dbo.ruta','nombre_ruta_normalizada') IS NULL
 ALTER TABLE dbo.ruta ADD nombre_ruta_normalizada AS UPPER(LTRIM(RTRIM(nombre_ruta))) PERSISTED;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.ruta') AND name='UX_ruta_nombre_normalizado')
 EXEC('CREATE UNIQUE INDEX UX_ruta_nombre_normalizado ON dbo.ruta(nombre_ruta_normalizada)');
COMMIT;
