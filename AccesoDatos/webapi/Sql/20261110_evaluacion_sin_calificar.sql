-- Permite guardar una evaluación mensual "sin calificar" (calificacion_desempeno NULL)
-- cuando el mes no tiene cobertura GPS/sensores suficiente. El modelo EF y el servicio ya
-- usan NULL desde la regla coverage-v2, pero el script de creación original definía la
-- columna como NOT NULL DEFAULT 100.00, lo que hacía fallar la consolidación.
-- Idempotente. Aplicar después de 20261017_push_operations.sql, con el servicio detenido.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource='eunice-schema-20261110-evaluacion',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;
IF @lock < 0 THROW 51110,'No se pudo bloquear la migracion de evaluaciones.',1;

DECLARE @default sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.evaluacion_piloto_mensual') AND c.name = 'calificacion_desempeno');
IF @default IS NOT NULL
    EXEC('ALTER TABLE dbo.evaluacion_piloto_mensual DROP CONSTRAINT ' + @default);

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.evaluacion_piloto_mensual')
           AND name = 'calificacion_desempeno' AND is_nullable = 0)
    ALTER TABLE dbo.evaluacion_piloto_mensual ALTER COLUMN calificacion_desempeno DECIMAL(5,2) NULL;

COMMIT TRANSACTION;
