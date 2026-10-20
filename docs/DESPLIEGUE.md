# Despliegue de API y web en VPS

Esta guía describe un despliegue manual con Linux, systemd, Nginx, .NET 10 y SQL Server accesible. Los nombres de servicio y carpetas de ejemplo deben adaptarse al servidor. No contiene direcciones IP, usuarios ni credenciales del entorno real.

## Compilar fuera del servidor

Desde la raíz, después de las pruebas:

```bash
dotnet publish AccesoDatos/webapi/webapi.csproj --configuration Release --runtime linux-x64 --self-contained false --output out/backend
npm --prefix frontend/frontendgarma ci
npm --prefix frontend/frontendgarma run build
```

`out/backend/` requiere el runtime ASP.NET Core 10 en el VPS. El frontend listo para servir está en `frontend/frontendgarma/dist/`. Este repositorio no incluye un instalador: copiar archivos no configura SQL Server, el servicio ni el proxy.

Mantén la configuración privada en un archivo protegido del servidor, por ejemplo `/etc/eunice/api.env`, referenciado por `EnvironmentFile` de la unidad systemd. El formato debe ser compatible con systemd; protege los valores con espacios y signos según corresponda. La API no lee `.env` por sí misma. Usa `AccesoDatos/webapi/.env.example` como lista de variables, sustituyendo todos los marcadores.

Configura `ASPNETCORE_ENVIRONMENT=Production`, `Database__ApplySchemaOnStartup=false` y `SeedSettings__SeedInitialUsers=false`. Usa una identidad SQL de ejecución limitada y una identidad separada para migraciones. Configura CORS y `AllowedHosts` para tus dominios HTTPS. Conserva `JWT_KEY` y las claves de Data Protection entre actualizaciones.

## Orden de actualización

1. Guarda copia recuperable de la base, los binarios actuales y la configuración privada; verifica cómo restaurarlos. Anota la versión desplegada.
2. Ejecuta `20261016_preflight.sql` en SSMS contra la base correcta. Investiga duplicados o conflictos; no borres históricos automáticamente para hacer pasar una migración.
3. Detén la API. Con el nombre de servicio de ejemplo:

   ```bash
   sudo systemctl stop eunice-api
   sudo systemctl is-active eunice-api
   ```

   El segundo comando debe indicar `inactive`; su código de salida distinto de cero es normal en ese estado.

4. En SSMS selecciona la base correcta y aplica las migraciones pendientes, completas y en este orden: `20261016_integridad.sql`, después `20261017_push_operations.sql`. No ejecutes el script de creación de base como sustituto de las migraciones de una instalación existente. Si falla una, revierte la transacción pendiente en la misma conexión y resuelve el error antes de continuar.
5. Sube por SFTP el **contenido** de `out/backend/` a la carpeta de la API y el **contenido** de `dist/` a la carpeta pública del panel. Conserva las configuraciones privadas, claves de protección y datos persistentes del VPS. Revisa propietarios/permisos y elimina únicamente archivos obsoletos que hayas identificado como parte de la versión anterior. Sustituye el HTML junto con sus assets para evitar mezclar versiones.
6. Inicia y comprueba la API:

   ```bash
   sudo systemctl start eunice-api
   sudo systemctl status eunice-api --no-pager
   sudo journalctl -u eunice-api -n 80 --no-pager
   curl --fail http://127.0.0.1:5059/health
   ```

7. Verifica desde el dominio público: acceso web, login, listado de usuarios, WebSocket y una operación autorizada. Comprueba push con cuentas/dispositivos de prueba propios.

Si solo cambian binarios y el esquema ya tiene las migraciones requeridas, no hay una migración nueva que inventar. La corrección de cuentas eliminadas se realiza en la lógica; conserva la estructura de SQL ya migrada.

## Proxy inverso

Nginx sirve los assets del frontend y el fallback SPA a `index.html`. Debe reenviar `/api/`, `/ws` y, si se publica, `/health` a `127.0.0.1:5059`. Conserva el prefijo `/api` al reenviar. `/ws` requiere HTTP/1.1 y encabezados Upgrade/Connection; transmite el host, dirección del cliente y esquema originales. El backend confía por defecto en el proxy local, no en cualquier remitente de Internet.

Publica únicamente HTTPS y mantén el puerto de la API limitado al host/proxy. Si ya existe una configuración funcional, actualizar archivos no exige reiniciar Nginx; si cambias su configuración, ejecuta `sudo nginx -t` y luego `sudo systemctl reload nginx` solo después de una validación correcta.

## Recuperación

Si la API no arranca, conserva el diagnóstico y detén el servicio antes de reemplazar binarios. Volver a una versión anterior puede requerir restaurar también la base si no es compatible con el nuevo esquema. No ejecutes un downgrade improvisado ni elimines tablas de la outbox para resolver un fallo.

No copies al repositorio archivos del VPS, variables de entorno, backups o logs con datos personales. Los binarios de Apple/Android se distribuyen por sus canales propios; no se instalan copiándolos a la carpeta de la API.
