-- READ ONLY. Run against the intended database before stopping/updating the API.
SELECT DB_NAME() AS base_actual, SERVERPROPERTY('ProductVersion') AS version_sql;
SELECT 'piloto_con_varios_viajes_activos' AS comprobacion,id_usuario AS id,COUNT(*) AS cantidad
 FROM dbo.viaje_diario WHERE estado_viaje='En Curso' GROUP BY id_usuario HAVING COUNT(*)>1;
SELECT 'autobus_con_varios_viajes_activos' AS comprobacion,id_autobus AS id,COUNT(*) AS cantidad
 FROM dbo.viaje_diario WHERE estado_viaje='En Curso' GROUP BY id_autobus HAVING COUNT(*)>1;
SELECT 'nombre_ruta_equivalente' AS comprobacion,MIN(id_ruta) AS id,COUNT(*) AS cantidad
 FROM dbo.ruta GROUP BY UPPER(LTRIM(RTRIM(nombre_ruta))) HAVING COUNT(*)>1;
SELECT 'posibles_duplicados_historicos_no_borrar_automaticamente' AS comprobacion,id_viaje,fecha_hora_dispositivo,COUNT(*) AS cantidad
 FROM dbo.telemetria_iot GROUP BY id_viaje,fecha_hora_dispositivo,latitud,longitud,velocidad_kmh HAVING COUNT(*)>1;
SELECT 'viaje_finalizado_sin_fecha_no_se_inventara' AS comprobacion,id_viaje
 FROM dbo.viaje_diario WHERE estado_viaje='Finalizado' AND fecha_fin IS NULL;
SELECT 'coordenadas_o_velocidad_fuera_de_rango' AS comprobacion,COUNT(*) AS cantidad
 FROM dbo.telemetria_iot WHERE latitud NOT BETWEEN -90 AND 90 OR longitud NOT BETWEEN -180 AND 180 OR velocidad_kmh NOT BETWEEN 0 AND 300;
SELECT i.name AS indice,t.name AS tabla,i.is_unique
 FROM sys.indexes i JOIN sys.tables t ON t.object_id=i.object_id
 WHERE t.name IN ('telemetria_iot','viaje_diario','ruta','autobus','usuario','evaluacion_piloto_mensual','dispositivo_push');
SELECT CASE WHEN OBJECT_ID('dbo.dispositivo_push','U') IS NULL THEN 'se_creara_con_la_migracion' ELSE 'existe' END AS registro_dispositivos_push;
SELECT name,is_enabled FROM sys.security_policies;
SELECT IS_SRVROLEMEMBER('sysadmin') AS conexion_es_sysadmin,IS_MEMBER('db_owner') AS conexion_es_db_owner;
