# Contribuir

Abre un issue para describir un problema funcional o proponer un cambio sin datos privados. Incluye pasos reproducibles, resultado esperado, versión y entorno de prueba. Para información sensible, sigue [SECURITY.md](SECURITY.md).

Mantén cada cambio enfocado y explica su efecto en API, web y móvil cuando afecte contratos compartidos. Usa fixtures sintéticos. Los cambios de esquema deben proporcionar SQL Server revisable y una secuencia de despliegue; no añadas DDL automático de producción como solución a una migración pendiente.

Antes de proponer una contribución:

1. Ejecuta las comprobaciones relevantes de [docs/PRUEBAS.md](docs/PRUEBAS.md).
2. Revisa el contenido que Git rastrea y ejecuta `python scripts/check_publication.py`.
3. Describe pruebas ejecutadas y límites: simulación local, SQL local, proveedor o dispositivo real.
4. Actualiza la documentación si cambias configuración, permisos o despliegue.

No incluyas `node_modules`, `bin`, `obj`, archivos `.env`, `appsettings` reales, credenciales, bases, capturas operativas ni binarios de tienda. La documentación y comentarios dirigidos al equipo se escriben preferentemente en español.

Este repositorio no declara una licencia general de código abierto. Consulta al propietario antes de redistribuir código o recursos de marca o de enviar aportes que dependan de derechos de terceros.
