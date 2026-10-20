# Avisos de terceros

Este proyecto depende de bibliotecas de .NET, npm, Expo y React Native. Las versiones y referencias se encuentran en los archivos `.csproj`, `package.json` y `package-lock.json`. Sus licencias y avisos se conservan en las distribuciones de cada paquete y deben revisarse al redistribuir una aplicación compilada.

## Leaflet

El mapa nativo incluye recursos JavaScript y CSS de Leaflet 1.9.4 en `mobileapp/src/screens/leafletAssets.ts`; el frontend también declara Leaflet como dependencia npm. El aviso y licencia BSD de dos cláusulas se incluyen en [third_party/Leaflet-LICENSE.txt](third_party/Leaflet-LICENSE.txt).

## Cartografía y rutas

El código utiliza cartografía OpenStreetMap y proveedores de búsqueda/rutas. Los componentes muestran atribución de mapa. Los derechos de los datos y las condiciones del servicio son distintos de la licencia del código de las bibliotecas. Antes de operar otra instalación, revisa las condiciones y límites de cada proveedor que configures.

Este documento no cambia la licencia de las dependencias ni establece una licencia general para el código o los recursos de marca del proyecto.
