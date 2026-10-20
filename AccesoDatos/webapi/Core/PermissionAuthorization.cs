using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

namespace webapi.Core
{
    // 1. Requerimiento de autorización personalizado
    public class PermissionRequirement : IAuthorizationRequirement
    {
        public string Permission { get; }

        public PermissionRequirement(string permission)
        {
            Permission = permission ?? throw new ArgumentNullException(nameof(permission));
        }
    }

    // 2. Manejador de autorización personalizado
    public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
    {
        protected override Task HandleRequirementAsync(
            AuthorizationHandlerContext context, 
            PermissionRequirement requirement)
        {
            // OBTENER IDENTIDAD DEL USUARIO
            var user = context.User;
            if (user == null || !user.Identity?.IsAuthenticated == true)
            {
                return Task.CompletedTask;
            }

            // REGLA DE SUPERADMINISTRADOR: FALLBACK AUTOMÁTICO
            // Si el usuario tiene el rol de "SuperAdministrador" (validando IsInRole o directamente los claims
            // de tipo role/Role para evitar desajustes de mapeo en .NET 8/9/10), se concede acceso total.
            bool esSuperAdmin = user.IsInRole("SuperAdministrador") || 
                                user.HasClaim(c => c.Type == ClaimTypes.Role && c.Value == "SuperAdministrador") ||
                                user.HasClaim(c => c.Type == "role" && c.Value == "SuperAdministrador");

            if (esSuperAdmin)
            {
                context.Succeed(requirement);
                return Task.CompletedTask;
            }

            // Los tokens nuevos incluyen permisos explícitos. El mapeo por rol mantiene
            // compatibles las sesiones emitidas antes de añadir esos claims; el rol del
            // token se contrasta contra la base de datos durante la autenticación.
            var role = user.FindFirstValue(ClaimTypes.Role)
                ?? user.FindFirstValue("role");
            var hasPermission = user.HasClaim(c => c.Type == "Permission" && c.Value == requirement.Permission)
                || (!string.IsNullOrWhiteSpace(role)
                    && AppPermissions.GetPermissionsForRole(role).Contains(requirement.Permission, StringComparer.Ordinal));
            if (hasPermission)
            {
                context.Succeed(requirement);
            }

            return Task.CompletedTask;
        }
    }

    // 3. Atributo personalizado para usar en controladores de forma declarativa: [HasPermission(AppPermissions.Usuarios.Crear)]
    [AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, Inherited = false, AllowMultiple = true)]
    public class HasPermissionAttribute : AuthorizeAttribute
    {
        public HasPermissionAttribute(string permission) : base(policy: permission)
        {
        }
    }
}
