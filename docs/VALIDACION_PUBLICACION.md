# Validación de la copia pública

Revisión local realizada el 19 de octubre de 2026 sobre la copia preparada para este repositorio, con dependencias instaladas desde los archivos lock. No se utilizó la base de datos del VPS.

| Comprobación | Resultado |
| --- | --- |
| Backend .NET en Release | 119 pruebas correctas, 0 fallidas, 0 omitidas. |
| Integración SQL Server | Incluida, contra LocalDB local y una base temporal aislada. |
| App móvil | 58 pruebas correctas, 0 fallidas. |
| TypeScript móvil | `tsc --noEmit` correcto. |
| Panel web | 6 pruebas correctas, lint y build de producción correctos. |
| Contenido de publicación | Revisión por lista permitida, patrones conocidos de secretos y comparación con los valores privados disponibles localmente. |

La configuración real no forma parte del índice de Git. Se inicia un historial nuevo; no se importa el historial del repositorio móvil interno. Se incluyen plantillas y se omiten archivos de proveedores, configuración operativa, binarios, bases y entregas.

La app pública incorpora configuración de destinos por `EXPO_PUBLIC_API_URL` y `EXPO_PUBLIC_API_FALLBACK_URL`; sin ella utiliza un dominio inválido. Los identificadores de proyecto EAS/Firebase y el destino de envío a App Store deben configurarse por el propietario de cada instalación.

La validación local no demuestra recepción push en un dispositivo físico, despliegue en el VPS, configuración de FCM/APNs ni aprobación de una tienda. El estado del workflow remoto se consulta en la pestaña Actions y puede diferir del ensayo local si su entorno no está configurado para una prueba opcional.
