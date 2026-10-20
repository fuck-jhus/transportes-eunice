using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using AccesoDatos.Context;
using AccesoDatos.Models;

namespace webapi.Core
{
    public static class DatabaseSeeder
    {
        public static async Task SeedAsync(PrevencionAccidentesBusesContext context, IConfiguration configuration, ILogger logger, bool isDevelopment)
        {
            try
            {
                // Verificar si la siembra inicial está habilitada
                bool seedEnabled = configuration.GetValue<bool>("SeedSettings:SeedInitialUsers", isDevelopment);

                if (!seedEnabled)
                {
                    logger.LogInformation("DatabaseSeeder: Siembra automática de usuarios desactivada por configuración.");
                    return;
                }

                // Verificar si ya existen usuarios para evitar sobreescritura
                bool anyUsers = await context.Usuarios.AnyAsync();
                if (anyUsers)
                {
                    logger.LogInformation("DatabaseSeeder: La base de datos ya contiene usuarios. Omitiendo siembra inicial.");
                    return;
                }

                // Obtener contraseñas iniciales desde configuración o variables de entorno
                var adminPassword = Environment.GetEnvironmentVariable("INITIAL_ADMIN_PASSWORD")
                                    ?? configuration["SeedSettings:InitialAdminPassword"]
                                    ?? throw new InvalidOperationException("Debe configurar INITIAL_ADMIN_PASSWORD antes de habilitar la siembra de usuarios.");

                var pilotPassword = isDevelopment
                    ? Environment.GetEnvironmentVariable("INITIAL_PILOT_PASSWORD")
                        ?? configuration["SeedSettings:InitialPilotPassword"]
                        ?? throw new InvalidOperationException("Debe configurar INITIAL_PILOT_PASSWORD antes de sembrar el piloto de desarrollo.")
                    : null;

                // 1. SuperAdministrador
                if (!await context.Usuarios.AnyAsync(u => u.UsuarioLogin == "superadmin"))
                {
                    context.Usuarios.Add(new Usuario
                    {
                        NombreCompleto = "Super Administrador del Sistema",
                        // La elevación de la cuenta principal se deriva de su identidad protegida;
                        // mantener el rol persistido como Administrador evita exponer ese rol en DTOs editables.
                        TipoRol = "Administrador",
                        UsuarioLogin = "superadmin",
                        Contrasena = BCrypt.Net.BCrypt.HashPassword(adminPassword),
                        Estado = "Activo"
                    });
                    logger.LogInformation("DatabaseSeeder: Cuenta 'superadmin' inicial creada con éxito.");
                }

                // 2. Administrador General
                if (!await context.Usuarios.AnyAsync(u => u.UsuarioLogin == "admin"))
                {
                    context.Usuarios.Add(new Usuario
                    {
                        NombreCompleto = "Administrador General",
                        TipoRol = "Administrador",
                        UsuarioLogin = "admin",
                        Contrasena = BCrypt.Net.BCrypt.HashPassword(adminPassword),
                        Estado = "Activo"
                    });
                    logger.LogInformation("DatabaseSeeder: Cuenta 'admin' inicial creada con éxito.");
                }

                // 3. Piloto de Ejemplo (Solo en desarrollo o si se requiere)
                if (isDevelopment && !await context.Usuarios.AnyAsync(u => u.UsuarioLogin == "piloto"))
                {
                    context.Usuarios.Add(new Usuario
                    {
                        NombreCompleto = "Juan Pérez (Piloto de Pruebas)",
                        TipoRol = "Piloto",
                        UsuarioLogin = "piloto",
                        Contrasena = BCrypt.Net.BCrypt.HashPassword(pilotPassword!),
                        Estado = "Activo"
                    });
                    logger.LogInformation("DatabaseSeeder: Cuenta de prueba 'piloto' creada con éxito.");
                }

                await context.SaveChangesAsync();
                logger.LogInformation("DatabaseSeeder: Proceso de inicialización de usuarios finalizado exitosamente.");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "DatabaseSeeder: Error al ejecutar la inicialización de la base de datos.");
                throw;
            }
        }
    }
}
