-- Mejoras para pasajeros:
--  * autobus.codigo_publico: código fijo del QR pegado en cada bus.
--  * conversacion_pasajero.fecha_derivada_piloto: el centro de control atiende primero;
--    el conductor solo ve la conversación desde que se le deriva.
--  * parada_ruta: paradas ordenadas de cada ruta para mostrar próxima parada y tiempo estimado.
-- Idempotente. Aplicar después de 20261110_evaluacion_sin_calificar.sql, con el servicio detenido.
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource='eunice-schema-20261111-pasajeros',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;
IF @lock < 0 THROW 51111,'No se pudo bloquear la migracion de pasajeros.',1;

IF COL_LENGTH('dbo.autobus','codigo_publico') IS NULL
    ALTER TABLE dbo.autobus ADD codigo_publico VARCHAR(48) NULL;

IF COL_LENGTH('dbo.conversacion_pasajero','fecha_derivada_piloto') IS NULL
    ALTER TABLE dbo.conversacion_pasajero ADD fecha_derivada_piloto DATETIME2 NULL;

IF OBJECT_ID('dbo.parada_ruta','U') IS NULL
BEGIN
    CREATE TABLE dbo.parada_ruta (
        id_parada INT IDENTITY(1,1) NOT NULL,
        id_ruta INT NOT NULL,
        orden INT NOT NULL,
        nombre NVARCHAR(100) NOT NULL,
        latitud DECIMAL(10,8) NOT NULL,
        longitud DECIMAL(11,8) NOT NULL,
        CONSTRAINT PK_parada_ruta PRIMARY KEY CLUSTERED (id_parada),
        CONSTRAINT FK_parada_ruta_ruta FOREIGN KEY (id_ruta) REFERENCES dbo.ruta (id_ruta) ON DELETE CASCADE,
        CONSTRAINT CK_parada_ruta_orden CHECK (orden >= 1),
        CONSTRAINT CK_parada_ruta_coordenadas CHECK (latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
    );
END;
COMMIT TRANSACTION;

-- Los índices filtrados van fuera de la transacción de DDL de columnas nuevas,
-- porque SQL Server no deja referenciar una columna agregada en el mismo lote.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.autobus') AND name='UX_autobus_codigo_publico')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_autobus_codigo_publico ON dbo.autobus (codigo_publico) WHERE codigo_publico IS NOT NULL;';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.parada_ruta') AND name='UX_parada_ruta_orden')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_parada_ruta_orden ON dbo.parada_ruta (id_ruta, orden);';
