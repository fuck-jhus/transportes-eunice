-- OPTIONAL ACTIVATION: run ONLY after the API includes DatabaseSessionContextInterceptor,
-- migrations have completed and the isolated RLS acceptance matrix passes.
-- This is single-organization owner/role isolation, NOT a multi-tenant model.
-- API SQL credentials and SESSION_CONTEXT are trusted. RLS does not protect a stolen
-- runtime SQL credential that can impersonate the middle tier, or a sysadmin.
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRANSACTION;
IF SCHEMA_ID('eunice_security') IS NULL EXEC('CREATE SCHEMA eunice_security AUTHORIZATION dbo');
IF OBJECT_ID('eunice_security.fn_owner_read') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_owner_read(@owner int) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE
 CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role'')) IN (N''System'',N''Administrador'',N''SuperAdministrador'',N''Supervisor'')
 OR (@owner=TRY_CONVERT(int,SESSION_CONTEXT(N''eunice_user'')) AND CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role''))=N''Piloto'')');
IF OBJECT_ID('eunice_security.fn_trip_read') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_trip_read(@trip int) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE EXISTS(SELECT 1 FROM dbo.viaje_diario v CROSS APPLY eunice_security.fn_owner_read(v.id_usuario) o WHERE v.id_viaje=@trip)
 OR EXISTS(SELECT 1 FROM dbo.viaje_acceso_publico a JOIN dbo.viaje_diario v ON v.id_viaje=a.id_viaje
 WHERE a.id_viaje=@trip AND a.token_hash=CONVERT(varchar(64),SESSION_CONTEXT(N''eunice_public''))
 AND a.fecha_revocacion IS NULL AND a.fecha_expiracion>SYSUTCDATETIME() AND v.modo_privacidad=0)');
IF OBJECT_ID('eunice_security.fn_trip_private') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_trip_private(@trip int) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE EXISTS(SELECT 1 FROM dbo.viaje_diario v CROSS APPLY eunice_security.fn_owner_read(v.id_usuario) o WHERE v.id_viaje=@trip)');
IF OBJECT_ID('eunice_security.fn_trip_write') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_trip_write(@trip int) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role'')) IN (N''System'',N''Administrador'',N''SuperAdministrador'')
 OR (CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role''))=N''Piloto'' AND EXISTS(SELECT 1 FROM dbo.viaje_diario v
 WHERE v.id_viaje=@trip AND v.id_usuario=TRY_CONVERT(int,SESSION_CONTEXT(N''eunice_user''))))');
IF OBJECT_ID('eunice_security.fn_chat_read') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_chat_read(@channel int) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role'')) IN (N''System'',N''Administrador'',N''SuperAdministrador'',N''Supervisor'')
 OR (CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role''))=N''Piloto'' AND (@channel=0 OR @channel=TRY_CONVERT(int,SESSION_CONTEXT(N''eunice_user''))))');
IF OBJECT_ID('eunice_security.fn_operator_write') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_operator_write(@owner int) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role'')) IN (N''System'',N''Administrador'',N''SuperAdministrador'')');
IF OBJECT_ID('eunice_security.fn_chat_write') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_chat_write(@channel int,@sender int) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role'')) IN (N''System'',N''Administrador'',N''SuperAdministrador'')
 OR (CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role''))=N''Piloto'' AND @sender=TRY_CONVERT(int,SESSION_CONTEXT(N''eunice_user''))
 AND (@channel=0 OR @channel=TRY_CONVERT(int,SESSION_CONTEXT(N''eunice_user''))))');
IF OBJECT_ID('eunice_security.fn_passenger_read') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_passenger_read(@conversation uniqueidentifier) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE EXISTS(SELECT 1 FROM dbo.conversacion_pasajero c JOIN dbo.viaje_acceso_publico a ON a.id_acceso=c.id_acceso
 CROSS APPLY eunice_security.fn_trip_private(a.id_viaje) p WHERE c.id_conversacion=@conversation)
 OR EXISTS(SELECT 1 FROM dbo.conversacion_pasajero c JOIN dbo.viaje_acceso_publico a ON a.id_acceso=c.id_acceso
 WHERE c.id_conversacion=@conversation AND c.sesion_hash=CONVERT(varchar(64),SESSION_CONTEXT(N''eunice_guest''))
 AND a.token_hash=CONVERT(varchar(64),SESSION_CONTEXT(N''eunice_public'')) AND a.fecha_revocacion IS NULL AND a.fecha_expiracion>SYSUTCDATETIME() AND a.chat_habilitado=1)');
IF OBJECT_ID('eunice_security.fn_passenger_write') IS NULL EXEC('
 CREATE FUNCTION eunice_security.fn_passenger_write(@conversation uniqueidentifier) RETURNS TABLE WITH SCHEMABINDING AS
 RETURN SELECT 1 AS allowed WHERE CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role'')) IN (N''System'',N''Administrador'',N''SuperAdministrador'')
 OR (CONVERT(nvarchar(30),SESSION_CONTEXT(N''eunice_role''))=N''Piloto'' AND EXISTS(SELECT 1 FROM dbo.conversacion_pasajero c
 JOIN dbo.viaje_acceso_publico a ON a.id_acceso=c.id_acceso CROSS APPLY eunice_security.fn_trip_private(a.id_viaje) p WHERE c.id_conversacion=@conversation))
 OR EXISTS(SELECT 1 FROM dbo.conversacion_pasajero c JOIN dbo.viaje_acceso_publico a ON a.id_acceso=c.id_acceso
 WHERE c.id_conversacion=@conversation AND c.sesion_hash=CONVERT(varchar(64),SESSION_CONTEXT(N''eunice_guest''))
 AND a.token_hash=CONVERT(varchar(64),SESSION_CONTEXT(N''eunice_public'')) AND a.fecha_revocacion IS NULL AND a.fecha_expiracion>SYSUTCDATETIME() AND a.chat_habilitado=1)');
IF NOT EXISTS(SELECT 1 FROM sys.security_policies WHERE name='EunicePrivateData') EXEC('
 CREATE SECURITY POLICY eunice_security.EunicePrivateData
 ADD FILTER PREDICATE eunice_security.fn_trip_read(id_viaje) ON dbo.telemetria_iot,
 ADD BLOCK PREDICATE eunice_security.fn_trip_write(id_viaje) ON dbo.telemetria_iot AFTER INSERT,
 ADD BLOCK PREDICATE eunice_security.fn_trip_write(id_viaje) ON dbo.telemetria_iot AFTER UPDATE,
 ADD BLOCK PREDICATE eunice_security.fn_operator_write(id_viaje) ON dbo.telemetria_iot BEFORE DELETE,
 ADD FILTER PREDICATE eunice_security.fn_trip_private(id_viaje) ON dbo.alerta_riesgo,
 ADD BLOCK PREDICATE eunice_security.fn_trip_write(id_viaje) ON dbo.alerta_riesgo AFTER INSERT,
 ADD BLOCK PREDICATE eunice_security.fn_trip_write(id_viaje) ON dbo.alerta_riesgo AFTER UPDATE,
 ADD BLOCK PREDICATE eunice_security.fn_operator_write(id_viaje) ON dbo.alerta_riesgo BEFORE DELETE,
 ADD FILTER PREDICATE eunice_security.fn_owner_read(id_usuario) ON dbo.evaluacion_piloto_mensual,
 ADD BLOCK PREDICATE eunice_security.fn_operator_write(id_usuario) ON dbo.evaluacion_piloto_mensual AFTER INSERT,
 ADD BLOCK PREDICATE eunice_security.fn_operator_write(id_usuario) ON dbo.evaluacion_piloto_mensual AFTER UPDATE,
 ADD BLOCK PREDICATE eunice_security.fn_operator_write(id_usuario) ON dbo.evaluacion_piloto_mensual BEFORE DELETE,
 ADD FILTER PREDICATE eunice_security.fn_chat_read(id_piloto_canal) ON dbo.mensaje_chat,
 ADD BLOCK PREDICATE eunice_security.fn_chat_write(id_piloto_canal,id_emisor) ON dbo.mensaje_chat AFTER INSERT,
 ADD BLOCK PREDICATE eunice_security.fn_chat_write(id_piloto_canal,id_emisor) ON dbo.mensaje_chat AFTER UPDATE,
 ADD BLOCK PREDICATE eunice_security.fn_chat_write(id_piloto_canal,id_emisor) ON dbo.mensaje_chat BEFORE DELETE,
 ADD FILTER PREDICATE eunice_security.fn_passenger_read(id_conversacion) ON dbo.mensaje_pasajero,
 ADD BLOCK PREDICATE eunice_security.fn_passenger_write(id_conversacion) ON dbo.mensaje_pasajero AFTER INSERT,
 ADD BLOCK PREDICATE eunice_security.fn_passenger_write(id_conversacion) ON dbo.mensaje_pasajero AFTER UPDATE
 WITH (STATE=ON, SCHEMABINDING=ON)');
COMMIT;
