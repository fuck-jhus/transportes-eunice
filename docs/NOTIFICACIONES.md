# Notificaciones móviles y web

El código implementa el registro y consumo de notificaciones. Cada instalación debe configurar sus propios proveedores: el repositorio no incluye claves de Firebase, APNs, Expo o VAPID.

## Flujo móvil

1. La app solicita permiso, registra el dispositivo y obtiene un token Expo para su proyecto.
2. El backend asocia el registro a la cuenta autenticada y a la instalación/plataforma.
3. Las operaciones crean eventos en la outbox de SQL Server. El procesador selecciona destinatarios autorizados y cuentas activas.
4. Expo entrega a FCM o APNs. El backend procesa los resultados, reintenta fallos transitorios y retira registros inválidos.
5. Al abrir un aviso, la app valida la sesión y navega al módulo autorizado. Al cerrar sesión o eliminar la cuenta se retira la vinculación correspondiente.

El código cubre avisos de viajes, asignaciones y cambios operativos, alertas, chat y atención a pasajeros, evaluaciones y seguimiento. Los destinatarios efectivos dependen del evento, permisos, suscripción y estado de la cuenta.

## Configurar Expo

Desde `mobileapp/`, inicia sesión con tu cuenta e inicializa un proyecto propio:

```bash
npx eas-cli login
npx eas-cli init
```

Comprueba que `expo.owner` y `expo.extra.eas.projectId` en `app.json` correspondan a tu proyecto. No se publican los del entorno real. Ajusta los identificadores nativos antes de configurar credenciales para una aplicación distinta.

## Android: Firebase y FCM v1

1. Crea un proyecto Firebase propio y registra una app Android con el mismo `android.package` de `app.json`.
2. Descarga su `google-services.json`. Guárdalo en `mobileapp/` solo localmente, o proporciona su ruta mediante la variable de archivo `GOOGLE_SERVICES_JSON` en EAS. El archivo está excluido de Git.
3. Configura la credencial de servicio FCM v1 en el proyecto EAS mediante `npx eas-cli credentials --platform android`. La clave privada de la cuenta de servicio se entrega al proveedor autorizado; no se copia al código ni al APK ni a la carpeta del VPS.
4. Si defines `expo.extra.firebaseProjectId`, debe coincidir con el archivo Firebase. `app.config.js` comprueba proyecto, paquete y estructura; `validate-push-build.cjs` bloquea builds Android de EAS sin configuración válida.

El canal Android es `operaciones`. La configuración incluye permiso `POST_NOTIFICATIONS`; su autorización depende de la versión de Android y de la elección de la persona.

## iOS: APNs

1. Registra el `ios.bundleIdentifier` en tu equipo Apple y prepara el perfil/certificado correspondiente.
2. Ejecuta `npx eas-cli credentials --platform ios` con acceso al equipo correcto y configura una clave APNs propia.
3. Conserva `.p8`, certificados, contraseñas y códigos 2FA fuera de Git. No reutilices ni reemplaces credenciales de otras aplicaciones sin autorización de su propietario.

`expo-notifications` incorpora la configuración nativa al generar el binario. Los permisos de ubicación en segundo plano y movimiento se declaran por separado; no equivalen a permiso de notificaciones.

## Generar binarios

Después de preparar proveedores, identificadores y entorno EAS:

```bash
npx eas-cli build --platform android --profile apk
npx eas-cli build --platform ios --profile production
```

El perfil `apk` genera una entrega Android interna. `production` genera el binario de tienda correspondiente. Esta copia no contiene `submit` con el identificador de App Store del propietario; configura tu envío de forma privada y revisa privacidad, permisos y metadatos antes de enviarlo.

Si activas la seguridad mejorada de Expo Push, proporciona `ExpoPush__AccessToken` al backend mediante su entorno privado. El archivo Firebase del cliente y la cuenta de servicio FCM v1 son materiales distintos; ninguno sustituye al otro.

## Push web de pasajeros

El panel público incluye `passenger-push-sw.js` y la gestión de suscripción de la conversación. Requiere navegador compatible, contexto seguro HTTPS y autorización explícita. La disponibilidad en iOS puede depender de la instalación de la web como aplicación y de la versión del sistema.

La API genera/guarda las claves VAPID protegidas en la base. Configura un `DataProtection__KeysPath` persistente y privado; restaurar la base sin sus claves de protección puede impedir descifrar suscripciones y enlaces protegidos. Revisa también el dominio de contacto VAPID en `GuestWebPushService.cs` para una instalación con otra identidad.

## Validación antes de entregar

Las pruebas locales simulan proveedores y dispositivos; no certifican entrega real. En un Android y un iPhone físicos, con binarios firmados y backend desplegado, comprueba:

- Permiso concedido y denegado; registro y rotación del token.
- Llegada en primer plano, segundo plano y con la app cerrada.
- Apertura del módulo correcto y rechazo si la cuenta ya no tiene permiso.
- Cambio de cuenta y logout sin entrega a la persona anterior.
- Evento real desde el servidor, ticket/recibo del proveedor y limpieza de un token inválido.

La aprobación de una tienda, el funcionamiento del VPS y la entrega de FCM/APNs son verificaciones independientes de que los tests de código pasen.
