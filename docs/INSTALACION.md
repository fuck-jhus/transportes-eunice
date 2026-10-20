# Instalación y configuración

Ejecuta los comandos desde la raíz del repositorio salvo que se indique otra carpeta. Usa .NET SDK 10, Node.js 24, npm y SQL Server. Las versiones exactas de dependencias se encuentran en los proyectos y sus archivos lock.

## 1. Preparar SQL Server

Para desarrollo en Windows se puede utilizar SQL Server LocalDB con autenticación integrada. En otros entornos, configura una instancia SQL Server accesible y una cuenta propia. No utilices una base de producción para pruebas.

Abre SQL Server Management Studio o `sqlcmd` y ejecuta en este orden:

1. `AccesoDatos/script_prevencion_accidentes_buses.sql`: crea la base `prevencion_accidentes_buses` y el esquema inicial, sin contraseñas ni registros de clientes.
2. Selecciona explícitamente esa base en la conexión.
3. `AccesoDatos/webapi/Sql/20261016_preflight.sql`: revisa el diagnóstico antes de continuar.
4. `AccesoDatos/webapi/Sql/20261016_integridad.sql`.
5. `AccesoDatos/webapi/Sql/20261017_push_operations.sql`.

Los dos últimos archivos son migraciones T-SQL, no migraciones de PostgreSQL ni comandos de Entity Framework. Ejecuta cada archivo completo, en una consulta sin transacciones pendientes. Si falla una migración, revisa el error y ejecuta `IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;` en esa misma sesión antes de corregirla y reintentar. No ignores un error para continuar con el siguiente archivo.

Los scripts `20261016_runtime_permissions.sql` y `20261016_rls.sql` son opcionales y requieren una revisión deliberada del administrador de base de datos. No actives RLS como un paso automático de instalación. La API debe ejecutar sin privilegios de modificación de esquema en producción; aplica migraciones con una identidad separada.

## 2. Configurar la API

Copia `AccesoDatos/webapi/appsettings.example.json` a `AccesoDatos/webapi/appsettings.Development.json`. El archivo de destino está excluido de Git. La plantilla desactiva cambios de esquema y creación de usuarios al iniciar.

ASP.NET Core carga configuración JSON, variables del proceso y User Secrets en desarrollo. **No carga automáticamente archivos `.env`**. El `.env.example` del backend es una referencia para el sistema que inicie el servicio.

Para una instalación LocalDB de desarrollo, en PowerShell:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet user-secrets set 'ConnectionStrings:DefaultConnection' 'Server=(localdb)\MSSQLLocalDB;Database=prevencion_accidentes_buses;Integrated Security=True;Encrypt=False;MultipleActiveResultSets=False' --project AccesoDatos/webapi
dotnet restore AccesoDatos/AccesoDatos.slnx
```

Para SQL Server remoto, proporciona tu cadena mediante User Secrets o `ConnectionStrings__DefaultConnection`; mantén el valor fuera del repositorio. El backend fuerza `MultipleActiveResultSets=false` para conservar savepoints en las transacciones.

En desarrollo la API genera una clave JWT efímera si no se configura una: al reiniciar se invalidan las sesiones previas. Para conservarlas, configura `Jwt:Key` en User Secrets. En producción, `JWT_KEY` debe contener un secreto aleatorio de al menos 32 caracteres y debe persistir entre reinicios.

### Crear las cuentas iniciales

Solo en una base nueva y vacía, habilita temporalmente `SeedSettings:SeedInitialUsers`. El seeder crea `superadmin` y `admin`; en desarrollo también crea `piloto`. Requiere una contraseña de administrador suministrada por `INITIAL_ADMIN_PASSWORD` o `SeedSettings:InitialAdminPassword`, y en desarrollo una de piloto mediante `INITIAL_PILOT_PASSWORD` o `SeedSettings:InitialPilotPassword`.

Puedes introducirlas sin mostrarlas en pantalla usando PowerShell 7:

```powershell
$env:INITIAL_ADMIN_PASSWORD = Read-Host 'Contraseña inicial de administración' -MaskInput
$env:INITIAL_PILOT_PASSWORD = Read-Host 'Contraseña inicial del piloto de prueba' -MaskInput
$env:SeedSettings__SeedInitialUsers = 'true'
dotnet run --project AccesoDatos/webapi --no-launch-profile
```

Después del primer inicio correcto, detén el proceso y retira las variables de bootstrap:

```powershell
Remove-Item Env:INITIAL_ADMIN_PASSWORD, Env:INITIAL_PILOT_PASSWORD, Env:SeedSettings__SeedInitialUsers
dotnet run --project AccesoDatos/webapi --no-launch-profile
```

La plantilla vuelve a dejar el seeder desactivado. El seeder no reemplaza usuarios si ya existen. Cambia las contraseñas iniciales de las cuentas administrativas después del bootstrap. No hay una contraseña predeterminada de producción.

La API escucha por defecto en `http://127.0.0.1:5059`. `/health` verifica conexión con la base; el documento OpenAPI de desarrollo está en `/openapi/v1.json`.

## 3. Ejecutar el panel web

```bash
cd frontend/frontendgarma
npm ci
```

Copia `.env.example` a `.env.local` y ejecuta `npm run dev`. La configuración por defecto usa `/api`; Vite redirige `/api` y `/ws` a `http://localhost:5059`. Para cambiar el destino del proxy, establece `VITE_PROXY_TARGET` **en el entorno del proceso** antes de iniciar Vite, ya que `vite.config.ts` lo lee desde `process.env`.

El navegador permite el uso de cookies de autenticación sin exponer el JWT a JavaScript. Si separas los orígenes, configura CORS, HTTPS y cookies de forma coherente. En producción se recomienda servir panel y API bajo el mismo dominio mediante proxy inverso.

## 4. Ejecutar la app móvil

```bash
cd mobileapp
npm ci
```

Copia `.env.example` a `.env.local` y define `EXPO_PUBLIC_API_URL` con tu API HTTPS o un túnel de desarrollo de confianza. Reinicia Metro cuando cambies el entorno. El repositorio usa por defecto `https://api.example.invalid`; no conecta automáticamente al servidor de la empresa.

`EXPO_PUBLIC_API_FALLBACK_URL` es opcional y debe apuntar a otro host del mismo backend. El cliente solo permite los dos destinos configurados y no reenvía automáticamente operaciones de escritura ante un fallo de red. Nunca pongas claves o contraseñas en variables `EXPO_PUBLIC_*`: se incorporan al paquete de la app.

Ejecuta `npm start` para iniciar Metro. GPS en segundo plano y notificaciones push requieren un binario nativo adecuado y las autorizaciones del dispositivo; Expo Go y la vista web no validan estas funciones. Consulta [NOTIFICACIONES.md](NOTIFICACIONES.md) antes de generar un binario.

La identidad de aplicación del código es `com.transporteseunice.mobile`. Para otra aplicación o propietario, cambia `android.package`, `ios.bundleIdentifier`, nombre, slug y recursos de marca, y registra esos identificadores en tus propios proveedores. No vincules una copia a proyectos de producción ajenos.
