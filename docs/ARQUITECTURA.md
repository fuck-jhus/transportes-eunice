# Arquitectura y comportamiento

## Backend y datos

`AccesoDatos/AccesoDatos` contiene las entidades y `PrevencionAccidentesBusesContext`. `AccesoDatos/webapi` implementa controladores, servicios y lógica de dominio. Las operaciones se autorizan por permisos además de por identidad y perfil.

Las rutas HTTP de negocio parten de `/api`; `/ws` sirve conexiones WebSocket y `/health` comprueba la conexión a SQL Server. `Program.cs` registra autenticación, CORS, límites de solicitudes, comprobaciones de cuenta activa y tareas en segundo plano. En desarrollo expone OpenAPI.

El navegador utiliza una cookie HttpOnly. La app móvil recibe un JWT y lo conserva mediante SecureStore. El servidor vuelve a verificar estado y perfil de la cuenta al validar la sesión; un token antiguo no debe conservar acceso tras una suspensión o eliminación.

El esquema usa SQL Server, índices únicos, versiones de concurrencia y transacciones. La API aplica las migraciones al inicio solo si se habilita `Database:ApplySchemaOnStartup`; en producción se utiliza validación del esquema y migración manual con el servicio detenido.

## Telemetría y viajes

Los módulos de viajes y telemetría administran asignaciones, inicio/finalización y fuentes de ubicación. La app incluye GPS, sensores, envío en vivo y archivo local de lecturas pendientes separado por usuario y viaje. La recepción identifica las lecturas para evitar duplicados; una falta de conectividad no equivale a una confirmación de guardado.

La frescura del GPS se calcula con el momento de observación. La interpolación de marcadores es una presentación visual y no debe producir lecturas nuevas. Las pruebas de navegación y sesión controlan relojes y señales para verificar estos límites.

Los mapas utilizan Leaflet/OpenStreetMap y servicios de búsqueda/rutas consumidos por el backend. Para una instalación propia, revisa su disponibilidad, atribución y condiciones antes de exponer tráfico público. Algunos nombres de componentes conservan referencias históricas a otros proveedores de mapas.

## Comunicación y notificaciones

El chat interno y la atención a pasajeros tienen permisos y destinatarios separados. Los enlaces públicos de viaje poseen vigencia y revocación; no conceden acceso al panel administrativo. La conversación de pasajero puede registrar una suscripción Web Push del navegador.

Los eventos operativos se encolan en SQL Server. `PushOutboxDispatcher` expande los destinatarios y procesa entregas; el servicio de Expo utiliza tickets/recibos y trata tokens que dejan de estar registrados. `PushBackgroundService` procesa las colas y comprueba avisos de seguimiento periódicamente.

Las suscripciones de pasajeros usan Web Push y claves VAPID protegidas con ASP.NET Data Protection. En producción se debe conservar el directorio de claves fuera del código y de los archivos que se reemplazan al desplegar.

## Eliminación de cuentas

`UserAccounts.cs` distingue una identidad eliminada generada por el servidor (`deleted_<id>_<random>`) de una cuenta normal suspendida o con un nombre similar. No se utiliza un filtro amplio de prefijo para ocultar usuarios.

La cuenta eliminada se excluye de listados operativos, autenticación, edición, activación y asignaciones. Se cierran sus sockets y se emite `usuario_eliminado` a los perfiles autorizados. El panel retira la tarjeta, descarta respuestas HTTP que pudieran restaurarla y vuelve a sincronizar al reconectar.

El registro anonimizado puede permanecer en SQL Server para preservar referencias de viajes y trazabilidad histórica. La desaparición del listado de administración no significa que se deban borrar relaciones históricas con una eliminación física en cascada.

## Alcance de la copia pública

La copia conserva código, pruebas, esquema, migraciones y recursos necesarios. Elimina identificadores de proyectos EAS/Firebase y configuración de envío a tiendas, además de credenciales y archivos privados. El destino móvil se configura por entorno para que una instalación nueva no envíe solicitudes al servidor real.

No incluye datos reales, historial Git de repositorios internos, credenciales de revisión de tiendas, grabaciones, capturas operativas ni binarios firmados. La configuración y documentación interna de despliegues anteriores no forman parte de la publicación.
