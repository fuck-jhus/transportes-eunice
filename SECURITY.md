# Seguridad y gestión de credenciales

La configuración real se mantiene fuera del repositorio y de su historial. No publiques cadenas SQL con contraseña, claves JWT, tokens de Expo, cuentas de servicio FCM, claves APNs, certificados, almacenes de firma, archivos de revisión de tiendas ni bases o registros operativos.

`.gitignore` excluye los archivos habituales, pero no retira archivos que Git ya rastree. Antes de cada envío, revisa el índice y ejecuta:

```bash
python scripts/check_publication.py
git diff --cached --stat
git status --short
```

El comprobador imprime solo rutas, líneas y categorías de hallazgos; nunca el valor que parece ser un secreto. Revisa también los cambios manualmente. Una exclusión o una comprobación sin hallazgos no garantiza que cualquier secreto posible haya sido detectado.

## Configuración privada

- API: variables de entorno o User Secrets en desarrollo. No uses cuentas SQL `sa`/`sysadmin` para la ejecución cotidiana. Aplica migraciones con una identidad separada.
- Web y Expo: los valores `VITE_*` y `EXPO_PUBLIC_*` son públicos dentro del cliente compilado. No sirven para almacenar secretos.
- Android: `google-services.json` local/variable de archivo en EAS y cuenta de servicio FCM v1 configurada en el proveedor. La clave privada de servicio no se incorpora a la app.
- iOS: credenciales APNs y firma en las herramientas del propietario; nunca en el código.
- Servidor: conservar y proteger `JWT_KEY` y el directorio de Data Protection, con respaldos privados y permisos limitados.

Los ejemplos contienen marcadores sin acceso a servicios. Las contraseñas incluidas en pruebas pertenecen a fixtures en bases aisladas; no son accesos de la aplicación publicada.

## Si se publica un secreto accidentalmente

Revócalo o rótalo en el proveedor y revisa su uso. Después elimina el archivo y limpia el historial afectado cuando corresponda. Borrar únicamente el valor del último commit no lo retira de commits previos ni invalida la credencial. Evita reproducir el secreto en issues, capturas o mensajes.

## Reportar un problema

Si GitHub ofrece el reporte privado de vulnerabilidades en la pestaña Security, utiliza ese canal. Si no está habilitado, solicita al propietario un canal privado sin adjuntar secretos, datos personales ni instrucciones de explotación en un issue público. Las pruebas deben usar instalaciones y cuentas propias autorizadas; la publicación del código no autoriza probar los servicios de producción.
