using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using AccesoDatos.Context;
using AccesoDatos.Models;
using webapi.Core;
using webapi.Services;

namespace webapi.Controllers
{
    [ApiController]
    [Route(ApiRoutes.Auth)]
    public class AuthController : ControllerBase
    {
        private readonly PrevencionAccidentesBusesContext _context;
        private readonly IConfiguration _configuration;
        private readonly ILogger<AuthController> _logger;
        private readonly IHostEnvironment _environment;
        private readonly IUserService _userService;
        private const string AuthCookieName = "AuthToken";
        private static readonly string DummyPasswordHash = BCrypt.Net.BCrypt.HashPassword("not-a-real-password");

        public AuthController(
            PrevencionAccidentesBusesContext context, 
            IConfiguration configuration,
            ILogger<AuthController> logger,
            IHostEnvironment environment,
            IUserService userService)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _userService = userService ?? throw new ArgumentNullException(nameof(userService));
        }

        /// <summary>
        /// Endpoint para iniciar sesión. Verifica las credenciales, genera un JWT
        /// e inyecta una cookie HTTP-Only con el token firmado.
        /// Protegido contra ataques de fuerza bruta mediante Rate Limiting.
        /// </summary>
        [HttpPost("login")]
        [EnableRateLimiting("AuthRateLimit")]
        public async Task<IActionResult> Login([FromBody] LoginRequestDto request)
        {
            if (!ModelState.IsValid || request == null || string.IsNullOrWhiteSpace(request.UsuarioLogin) || string.IsNullOrWhiteSpace(request.Contrasena))
            {
                return BadRequest(new { mensaje = "El usuario y la contraseña son requeridos." });
            }

            try
            {
                Response.Headers.CacheControl = "no-store";
                var normalizedLogin = request.UsuarioLogin.Trim();

                // Buscar el usuario en la base de datos
                var usuario = await _context.Usuarios
                    .WithoutDeletedAccounts()
                    .AsNoTracking()
                    .FirstOrDefaultAsync(u => u.UsuarioLogin == normalizedLogin);

                // Ejecutar siempre BCrypt evita revelar si el usuario existe por diferencias de tiempo.
                var passwordHash = usuario?.Contrasena ?? DummyPasswordHash;
                var passwordValida = BCrypt.Net.BCrypt.Verify(request.Contrasena, passwordHash);
                if (usuario == null || !passwordValida || !string.Equals(usuario.Estado, "Activo", StringComparison.Ordinal))
                {
                    return Unauthorized(new { mensaje = "Credenciales incorrectas o usuario inactivo." });
                }

                // Generar el JWT Token
                var token = GenerarJwtToken(usuario);

                var cookieOptions = CreateAuthCookieOptions(DateTimeOffset.UtcNow.AddHours(8));

                // Insertar la cookie en la respuesta HTTP
                Response.Cookies.Append(AuthCookieName, token, cookieOptions);

                // Inyectar virtualmente el rol SuperAdministrador para el frontend
                var virtualRole = usuario.UsuarioLogin.ToLower() == "superadmin" ? "SuperAdministrador" : usuario.TipoRol;

                // El token queda exclusivamente en la cookie HttpOnly y nunca se expone a JavaScript.
                return Ok(new UserResponseDto
                {
                    IdUsuario = usuario.IdUsuario,
                    NombreCompleto = usuario.NombreCompleto,
                    TipoRol = virtualRole,
                    UsuarioLogin = usuario.UsuarioLogin,
                    Estado = usuario.Estado
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error durante el inicio de sesión para el usuario {UsuarioLogin}", request.UsuarioLogin);
                return StatusCode(500, new { mensaje = "Ocurrió un error interno en el servidor." });
            }
        }

        /// <summary>
        /// Inicio de sesión para clientes móviles nativos. A diferencia del sitio web,
        /// el cliente nativo necesita recibir el JWT para guardarlo en el almacén seguro
        /// del sistema operativo y enviarlo mediante el encabezado Authorization.
        /// </summary>
        [HttpPost("mobile-login")]
        [EnableRateLimiting("AuthRateLimit")]
        public async Task<IActionResult> MobileLogin([FromBody] LoginRequestDto request)
        {
            if (!ModelState.IsValid || request == null || string.IsNullOrWhiteSpace(request.UsuarioLogin) || string.IsNullOrWhiteSpace(request.Contrasena))
            {
                return BadRequest(new { mensaje = "El usuario y la contraseña son requeridos." });
            }

            try
            {
                Response.Headers.CacheControl = "no-store";
                var normalizedLogin = request.UsuarioLogin.Trim();
                var usuario = await _context.Usuarios
                    .WithoutDeletedAccounts()
                    .AsNoTracking()
                    .FirstOrDefaultAsync(u => u.UsuarioLogin == normalizedLogin);

                var passwordHash = usuario?.Contrasena ?? DummyPasswordHash;
                var passwordValida = BCrypt.Net.BCrypt.Verify(request.Contrasena, passwordHash);
                if (usuario == null || !passwordValida || !string.Equals(usuario.Estado, "Activo", StringComparison.Ordinal))
                {
                    return Unauthorized(new { mensaje = "Credenciales incorrectas o usuario inactivo." });
                }

                var token = GenerarJwtToken(usuario);
                Response.Cookies.Append(AuthCookieName, token, CreateAuthCookieOptions(DateTimeOffset.UtcNow.AddHours(8)));
                var virtualRole = usuario.UsuarioLogin.ToLower() == "superadmin" ? "SuperAdministrador" : usuario.TipoRol;
                return Ok(new MobileLoginResponseDto
                {
                    Token = token,
                    ExpiresAtUtc = DateTime.UtcNow.AddHours(8),
                    Usuario = new UserResponseDto
                    {
                        IdUsuario = usuario.IdUsuario,
                        NombreCompleto = usuario.NombreCompleto,
                        TipoRol = virtualRole,
                        UsuarioLogin = usuario.UsuarioLogin,
                        Estado = usuario.Estado
                    }
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error durante el inicio de sesión móvil para el usuario {UsuarioLogin}", request.UsuarioLogin);
                return StatusCode(500, new { mensaje = "Ocurrió un error interno en el servidor." });
            }
        }

        /// <summary>
        /// Endpoint para cerrar sesión. Remueve la cookie borrando su valor y notifica el estado offline a los tableros.
        /// </summary>
        [Authorize]
        [HttpPost("logout")]
        public async Task<IActionResult> Logout()
        {
            try
            {
                var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (!string.IsNullOrEmpty(idClaim) && int.TryParse(idClaim, out int idUsuario))
                {
                    var viaje = await _context.ViajesDiarios
                        .Include(v => v.IdAutobusNavigation)
                        .Include(v => v.IdUsuarioNavigation)
                        .FirstOrDefaultAsync(v => v.IdUsuario == idUsuario && v.EstadoViaje == "En Curso");

                    var placa = viaje?.IdAutobusNavigation?.Placa;
                    var nombre = viaje?.IdUsuarioNavigation?.NombreCompleto;

                    await WebSocketConnectionManager.BroadcastPilotOfflineAsync(idUsuario, placa, nombre);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al notificar desconexión en Logout");
            }

            Response.Headers.CacheControl = "no-store";
            var cookieOptions = CreateAuthCookieOptions(DateTimeOffset.UtcNow.AddDays(-1));

            Response.Cookies.Delete(AuthCookieName, cookieOptions);

            return Ok(new { mensaje = "Sesión cerrada correctamente." });
        }

        /// <summary>
        /// Permite que el titular elimine su propia cuenta desde la aplicación.
        /// Los registros operativos exigidos por seguridad se conservan sin datos personales.
        /// </summary>
        [Authorize]
        [HttpDelete("cuenta")]
        [EnableRateLimiting("AuthRateLimit")]
        public async Task<IActionResult> DeleteOwnAccount([FromBody] EliminarCuentaDto request)
        {
            Response.Headers.CacheControl = "no-store";
            var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!int.TryParse(idClaim, out var currentUserId))
            {
                return Unauthorized(new { mensaje = "La sesión no contiene una identidad válida." });
            }

            var currentUser = await _context.Usuarios
                .WithoutDeletedAccounts()
                .AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdUsuario == currentUserId && item.Estado == "Activo");
            if (currentUser is null)
            {
                return Unauthorized(new { mensaje = "La cuenta ya no está activa." });
            }

            if (!BCrypt.Net.BCrypt.Verify(request.Contrasena, currentUser.Contrasena))
            {
                return BadRequest(new { mensaje = "La contraseña actual no es correcta." });
            }

            var deleted = await _userService.EliminarUsuarioAsync(currentUserId);
            if (!deleted)
            {
                return NotFound(new { mensaje = "La cuenta ya no existe." });
            }

            Response.Cookies.Delete(
                AuthCookieName,
                CreateAuthCookieOptions(DateTimeOffset.UtcNow.AddDays(-1)));

            return Ok(new
            {
                mensaje = "Tu cuenta fue eliminada. Los registros de seguridad obligatorios se conservaron sin tus datos personales."
            });
        }

        /// <summary>
        /// Endpoint protegido para consultar la identidad del usuario actual
        /// a partir del JWT inyectado en la cookie HttpOnly o encabezado Authorization.
        /// </summary>
        [Authorize]
        [HttpGet("me")]
        public async Task<IActionResult> GetMe()
        {
            try
            {
                Response.Headers.CacheControl = "no-store";
                // Extraer el ID del usuario desde los Claims del JWT
                var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (string.IsNullOrEmpty(idClaim) || !int.TryParse(idClaim, out int idUsuario))
                {
                    return Unauthorized(new { mensaje = "Token no contiene un ID de usuario válido." });
                }

                // Buscar el usuario en la BD para validar que siga activo
                var usuario = await _context.Usuarios
                    .WithoutDeletedAccounts()
                    .AsNoTracking()
                    .FirstOrDefaultAsync(u => u.IdUsuario == idUsuario);

                if (usuario == null || usuario.Estado != "Activo")
                {
                    Response.Cookies.Delete(AuthCookieName, CreateAuthCookieOptions(DateTimeOffset.UtcNow.AddDays(-1)));
                    return Unauthorized(new { mensaje = "El usuario ya no está activo o no existe." });
                }

                // Inyectar virtualmente el rol SuperAdministrador para el frontend
                var virtualRole = usuario.UsuarioLogin.ToLower() == "superadmin" ? "SuperAdministrador" : usuario.TipoRol;

                return Ok(new UserResponseDto
                {
                    IdUsuario = usuario.IdUsuario,
                    NombreCompleto = usuario.NombreCompleto,
                    TipoRol = virtualRole,
                    UsuarioLogin = usuario.UsuarioLogin,
                    Estado = usuario.Estado
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al verificar el estado de la sesión en /me");
                return StatusCode(500, new { mensaje = "Error al verificar el estado de la sesión." });
            }
        }

        #region Métodos Auxiliares

        private string GenerarJwtToken(Usuario usuario)
        {
            var jwtKey = _configuration["Jwt:Key"]
                         ?? throw new InvalidOperationException("La clave JWT no está configurada.");
            
            var jwtIssuer = Environment.GetEnvironmentVariable("JWT_ISSUER") 
                            ?? _configuration["Jwt:Issuer"] 
                            ?? "https://transporteseunice.com";
            
            var jwtAudience = Environment.GetEnvironmentVariable("JWT_AUDIENCE") 
                              ?? _configuration["Jwt:Audience"] 
                              ?? "https://transporteseunice.com";

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var role = usuario.UsuarioLogin.ToLower() == "superadmin" ? "SuperAdministrador" : usuario.TipoRol;

            var claimsList = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, usuario.IdUsuario.ToString()),
                new Claim(ClaimTypes.Name, usuario.NombreCompleto),
                new Claim(ClaimTypes.Role, role),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
            };

            var permissions = AppPermissions.GetPermissionsForRole(role);
            foreach (var permission in permissions)
            {
                claimsList.Add(new Claim("Permission", permission));
            }

            var token = new JwtSecurityToken(
                issuer: jwtIssuer,
                audience: jwtAudience,
                claims: claimsList,
                expires: DateTime.UtcNow.AddHours(8),
                signingCredentials: creds
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private CookieOptions CreateAuthCookieOptions(DateTimeOffset expires) => new()
        {
            HttpOnly = true,
            Secure = !_environment.IsDevelopment() || Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Expires = expires,
            MaxAge = expires > DateTimeOffset.UtcNow ? TimeSpan.FromHours(8) : TimeSpan.Zero,
            IsEssential = true,
            Path = "/"
        };

        #endregion
    }

    #region DTOs

    public class LoginRequestDto
    {
        [Required]
        [StringLength(50)]
        public string UsuarioLogin { get; set; } = string.Empty;

        [Required]
        [StringLength(200)]
        public string Contrasena { get; set; } = string.Empty;
    }

    public class UserResponseDto
    {
        public byte[] Version { get; set; } = [];
        public int IdUsuario { get; set; }
        public string NombreCompleto { get; set; } = string.Empty;
        public string TipoRol { get; set; } = string.Empty;
        public string UsuarioLogin { get; set; } = string.Empty;
        public string? Estado { get; set; }
    }

    public class MobileLoginResponseDto
    {
        public string Token { get; set; } = string.Empty;
        public DateTime ExpiresAtUtc { get; set; }
        public UserResponseDto Usuario { get; set; } = new();
    }

    public sealed class EliminarCuentaDto
    {
        [Required]
        [StringLength(200, MinimumLength = 1)]
        public string Contrasena { get; set; } = string.Empty;
    }

    #endregion
}
