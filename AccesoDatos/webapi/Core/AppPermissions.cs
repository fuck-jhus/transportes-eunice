using System.Reflection;

namespace webapi.Core
{
    public static class AppPermissions
    {
        public static class Usuarios
        {
            public const string Consultar = "Permissions.Usuarios.Consultar";
            public const string Crear = "Permissions.Usuarios.Crear";
            public const string Editar = "Permissions.Usuarios.Editar";
            public const string CambiarEstado = "Permissions.Usuarios.CambiarEstado";
            public const string Eliminar = "Permissions.Usuarios.Eliminar";
        }

        public static class Telemetria
        {
            public const string Consultar = "Permissions.Telemetria.Consultar";
            public const string Enviar = "Permissions.Telemetria.Enviar";
        }

        public static class Autobuses
        {
            public const string Consultar = "Permissions.Autobuses.Consultar";
            public const string Crear = "Permissions.Autobuses.Crear";
            public const string Editar = "Permissions.Autobuses.Editar";
            public const string Eliminar = "Permissions.Autobuses.Eliminar";
        }

        public static class Rutas
        {
            public const string Consultar = "Permissions.Rutas.Consultar";
            public const string Crear = "Permissions.Rutas.Crear";
            public const string Editar = "Permissions.Rutas.Editar";
            public const string Eliminar = "Permissions.Rutas.Eliminar";
        }

        public static class Viajes
        {
            public const string Consultar = "Permissions.Viajes.Consultar";
            public const string Crear = "Permissions.Viajes.Crear";
            public const string Finalizar = "Permissions.Viajes.Finalizar";
        }

        /// <summary>
        /// Obtiene dinámicamente todos los permisos declarados en esta clase mediante reflexión.
        /// Esto garantiza que cualquier permiso que se agregue en el futuro sea detectado automáticamente.
        /// </summary>
        public static IEnumerable<string> GetAllPermissions()
        {
            var permissions = new List<string>();
            var nestedTypes = typeof(AppPermissions).GetNestedTypes(BindingFlags.Public | BindingFlags.Static);

            foreach (var type in nestedTypes)
            {
                var fields = type.GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
                                 .Where(f => f.IsLiteral && !f.IsInitOnly && f.FieldType == typeof(string));

                foreach (var field in fields)
                {
                    var value = field.GetRawConstantValue()?.ToString();
                    if (!string.IsNullOrEmpty(value))
                    {
                        permissions.Add(value);
                    }
                }
            }

            return permissions;
        }

        /// <summary>
        /// Asocia y retorna la lista de permisos correspondientes a cada rol del sistema.
        /// </summary>
        public static IEnumerable<string> GetPermissionsForRole(string role)
        {
            switch (role)
            {
                case "SuperAdministrador":
                    return GetAllPermissions();

                case "Administrador":
                    // El Administrador tiene control completo sobre la gestión de usuarios
                    // y accesos de lectura en los demás módulos del sistema
                    return new[]
                    {
                        Usuarios.Consultar,
                        Usuarios.Crear,
                        Usuarios.Editar,
                        Usuarios.CambiarEstado,
                        Usuarios.Eliminar,
                        Telemetria.Consultar,
                        Autobuses.Consultar,
                        Autobuses.Crear,
                        Autobuses.Editar,
                        Autobuses.Eliminar,
                        Rutas.Consultar,
                        Rutas.Crear,
                        Rutas.Editar,
                        Rutas.Eliminar,
                        Viajes.Consultar,
                        Viajes.Crear,
                        Viajes.Finalizar
                    };

                case "Supervisor":
                    // El Supervisor solo tiene permisos de visualización/auditoría
                    return new[]
                    {
                        Usuarios.Consultar,
                        Telemetria.Consultar,
                        Autobuses.Consultar,
                        Rutas.Consultar,
                        Viajes.Consultar
                    };

                case "Piloto":
                    // El piloto puede consultar y cerrar únicamente sus propios viajes.
                    // La comprobación de propiedad se realiza además en ViajesController/Service.
                    return new[]
                    {
                        Telemetria.Enviar,
                        Rutas.Consultar,
                        Viajes.Consultar,
                        Viajes.Finalizar
                    };

                default:
                    return Array.Empty<string>();
            }
        }
    }
}
