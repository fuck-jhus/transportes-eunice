-- Optional role provisioning, after migrations. A DBA must add ONLY the runtime
-- database user to this role, remove its db_owner/sysadmin membership separately,
-- and set Database__ApplySchemaOnStartup=false. No password/login is created here.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DATABASE_PRINCIPAL_ID('eunice_runtime') IS NULL CREATE ROLE eunice_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON SCHEMA::dbo TO eunice_runtime;
DENY ALTER ON SCHEMA::dbo TO eunice_runtime;
DENY ALTER ANY SECURITY POLICY TO eunice_runtime;
COMMIT;
-- DBA example, replace the placeholder explicitly:
-- ALTER ROLE eunice_runtime ADD MEMBER [USUARIO_SQL_APP];
-- Never use the migration principal as the API runtime identity.
