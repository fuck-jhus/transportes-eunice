# Pruebas y límites de validación

Instala dependencias con los archivos lock antes de ejecutar las pruebas. Los tests web reutilizan el cargador TypeScript de `mobileapp/tests/helpers`, por lo que también requieren `npm ci` en `mobileapp/`.

Desde la raíz:

```bash
dotnet restore AccesoDatos/AccesoDatos.slnx
dotnet test AccesoDatos/AccesoDatos.slnx --configuration Release
npm --prefix mobileapp ci
npm --prefix mobileapp run test:all
npm --prefix mobileapp exec -- tsc --noEmit --project mobileapp/tsconfig.json
npm --prefix frontend/frontendgarma ci
npm --prefix frontend/frontendgarma test
npm --prefix frontend/frontendgarma run lint
npm --prefix frontend/frontendgarma run build
python scripts/check_publication.py
```

Para comprobar TypeScript también se puede entrar a `mobileapp/` y ejecutar `npx tsc --noEmit`.

Los resultados de la revisión inicial están en [VALIDACION_PUBLICACION.md](VALIDACION_PUBLICACION.md).

## Integración SQL Server

Las pruebas habituales emplean una base en memoria donde resulta apropiado. La prueba marcada `IsolatedSqlFact` se omite si falta `EUNICE_SQL_TEST_CONNECTION`; no se debe interpretar esa omisión como una prueba aprobada de concurrencia o RLS.

En Windows con una instancia **local de pruebas** de LocalDB, desde PowerShell:

```powershell
$env:EUNICE_SQL_TEST_CONNECTION = 'Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=True;Encrypt=False;MultipleActiveResultSets=False'
dotnet test AccesoDatos/AccesoDatos.slnx --configuration Release
Remove-Item Env:EUNICE_SQL_TEST_CONNECTION
```

La prueba valida que la instancia sea local, crea una base temporal con nombre aleatorio y la elimina al terminar. Necesita permisos locales para crear/eliminar esa base. No toma las credenciales del `appsettings` de la aplicación ni se debe ejecutar contra producción.

La integración cubre precisión de fecha, restricciones únicas, idempotencia, operaciones concurrentes, migraciones y contexto de seguridad con conexiones agrupadas. Los tests de cuenta eliminada cubren su retiro de servicios y autorización. Los tests móviles simulan almacenamiento, red, relojes y notificaciones; no son ensayos de un teléfono físico.

## Integración continua

El workflow de GitHub ejecuta comprobaciones de publicación, backend, tests móviles, TypeScript y web. No utiliza secretos de despliegue ni publica binarios. En su entorno por defecto la integración SQL se omite porque no hay una instancia SQL local configurada.

La revisión de publicación busca tipos de archivo privados y patrones conocidos de credenciales en los archivos rastreados por Git. Complementa la revisión manual y la búsqueda de valores privados antes del primer envío; no detecta cualquier secreto posible.

## Comprobaciones externas

No se consideran demostradas por un build o por tests simulados: migración del VPS real, HTTPS/proxy público, entrega APNs/FCM, recepción con la aplicación cerrada, comportamiento GPS con el teléfono bloqueado, binarios firmados ni aprobación de App Store. Registra esas comprobaciones por separado con fecha, versión y entorno, sin incluir datos personales o tokens.
