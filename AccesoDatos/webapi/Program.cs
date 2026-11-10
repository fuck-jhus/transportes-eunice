using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using System.Net.WebSockets;
using Microsoft.EntityFrameworkCore;
using AccesoDatos.Context;
using AccesoDatos.Models;
using System.Text.Json;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;
using webapi.Dtos;
using webapi.Services;
using webapi.Core;

var builder = WebApplication.CreateBuilder(args);

// Mantener el registro portable: evita que un fallo al escribir en el Event Log de Windows
// oculte la excepción real de la aplicación en cuentas sin privilegios administrativos.
builder.Logging.ClearProviders();
builder.Logging.AddConsole();

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 2 * 1024 * 1024;
});

// Configuración de URLs de escucha (prioriza ASPNETCORE_URLS, por defecto localhost:5059 para proxy inverso seguro)
var urls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS") ?? builder.Configuration["Urls"] ?? "http://127.0.0.1:5059";
builder.WebHost.UseUrls(urls);

// Servicios de controladores y OpenAPI
builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("Nominatim", client =>
{
    client.BaseAddress = new Uri("https://nominatim.openstreetmap.org/");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("EuniceFleetOperations/1.0 (transporteseunice.com)");
    client.Timeout = TimeSpan.FromSeconds(8);
});
builder.Services.AddHttpClient("Osrm", client =>
{
    client.BaseAddress = new Uri("https://routing.openstreetmap.de/routed-car/");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("EuniceFleetOperations/1.0 (transporteseunice.com)");
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    client.Timeout = TimeSpan.FromSeconds(4);
});
builder.Services.AddHttpClient("OsrmFallback", client =>
{
    client.BaseAddress = new Uri("https://router.project-osrm.org/");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("EuniceFleetOperations/1.0 (transporteseunice.com)");
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    client.Timeout = TimeSpan.FromSeconds(4);
});
builder.Services.AddHttpClient("BRouter", client =>
{
    client.BaseAddress = new Uri("https://brouter.de/brouter-web/");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("EuniceFleetOperations/1.0 (transporteseunice.com)");
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    client.Timeout = TimeSpan.FromSeconds(4);
});
builder.Services.AddHttpClient("ExpoPush", (services, client) =>
{
    client.BaseAddress = new Uri("https://exp.host/--/api/v2/push/");
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    client.Timeout = TimeSpan.FromSeconds(10);
    var accessToken = services.GetRequiredService<IConfiguration>()["ExpoPush:AccessToken"];
    if (!string.IsNullOrWhiteSpace(accessToken))
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken.Trim());
});

var protection = builder.Services.AddDataProtection().SetApplicationName("EuniceFleet");
var protectionKeysPath = builder.Configuration["DataProtection:KeysPath"];
if (!string.IsNullOrWhiteSpace(protectionKeysPath)) protection.PersistKeysToFileSystem(new DirectoryInfo(protectionKeysPath));
if (builder.Environment.IsDevelopment())
{
    // Evita depender de llaves DPAPI del perfil de otro proceso durante desarrollo local.
    builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
}

// Cadena de conexión a Base de Datos
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString))
{
    if (builder.Environment.IsDevelopment())
    {
        connectionString = "Server=localhost;Database=prevencion_accidentes_buses;TrustServerCertificate=True;Integrated Security=True;MultipleActiveResultSets=True";
    }
    else
    {
        throw new InvalidOperationException("La cadena de conexión 'DefaultConnection' no está configurada. En producción debe proporcionarse mediante la variable de entorno ConnectionStrings__DefaultConnection.");
    }
}

// EF usa savepoints para recuperar una transaccion si SaveChanges falla. MARS los desactiva
// y deja la transaccion en estado incierto; este backend no requiere lectores simultaneos.
var sqlConnectionBuilder = new SqlConnectionStringBuilder(connectionString)
{
    MultipleActiveResultSets = false
};
connectionString = sqlConnectionBuilder.ConnectionString;

builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<DatabaseSessionContextInterceptor>();
builder.Services.AddDbContext<PrevencionAccidentesBusesContext>((services, options) =>
    options.UseSqlServer(connectionString, sqlOptions =>
    {
        sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(10),
            errorNumbersToAdd: null);
    }).AddInterceptors(services.GetRequiredService<DatabaseSessionContextInterceptor>()));

// Inyección de dependencias de servicios de la aplicación
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IAutobusService, AutobusService>();
builder.Services.AddScoped<IRutaService, RutaService>();
builder.Services.AddScoped<IViajeService, ViajeService>();
builder.Services.AddScoped<ITelemetriaService, TelemetriaService>();
builder.Services.AddScoped<IEvaluacionService, EvaluacionService>();
builder.Services.AddScoped<IPushNotificationService, ExpoPushNotificationService>();
builder.Services.AddScoped<PushOutboxDispatcher>();
builder.Services.AddScoped<TrackingNotificationMonitor>();
builder.Services.AddScoped<GuestWebPushService>();
builder.Services.AddHttpClient("GuestWebPush", client => client.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHostedService<PushBackgroundService>();
builder.Services.AddHostedService<MonthlyEvaluationService>();

// Configuración de JWT
var jwtKey = Environment.GetEnvironmentVariable("JWT_KEY") ?? builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
{
    if (builder.Environment.IsDevelopment())
    {
        // Clave efímera para desarrollo: evita dejar secretos reutilizables en el repositorio.
        // Para conservar sesiones entre reinicios configure JWT_KEY con Secret Manager.
        jwtKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
    }
    else
    {
        throw new InvalidOperationException("La clave secreta JWT (Jwt:Key) debe tener al menos 32 caracteres. En producción configure la variable de entorno JWT_KEY.");
    }
}

var jwtIssuer = Environment.GetEnvironmentVariable("JWT_ISSUER") 
                ?? builder.Configuration["Jwt:Issuer"] 
                ?? "https://transporteseunice.com";

var jwtAudience = Environment.GetEnvironmentVariable("JWT_AUDIENCE") 
                  ?? builder.Configuration["Jwt:Audience"] 
                  ?? "https://transporteseunice.com";

// Deja una única fuente efectiva para la emisión y validación de tokens.
builder.Configuration["Jwt:Key"] = jwtKey;
builder.Configuration["Jwt:Issuer"] = jwtIssuer;
builder.Configuration["Jwt:Audience"] = jwtAudience;

// Una sola definición de cómo se valida un token, compartida por la API y el WebSocket.
var tokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidateAudience = true,
    ValidateLifetime = true,
    ValidateIssuerSigningKey = true,
    ValidIssuer = jwtIssuer,
    ValidAudience = jwtAudience,
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
    ClockSkew = TimeSpan.Zero,
    NameClaimType = ClaimTypes.Name,
    RoleClaimType = ClaimTypes.Role
};

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = tokenValidationParameters;

    // El encabezado Authorization lo resuelve JwtBearer automáticamente. Para el navegador,
    // la cookie HttpOnly evita exponer el token a JavaScript y reduce el impacto de un XSS.
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            if (context.Request.Cookies.TryGetValue("AuthToken", out var token) && !string.IsNullOrWhiteSpace(token))
            {
                context.Token = token;
            }
            return Task.CompletedTask;
        },
        OnTokenValidated = async context =>
        {
            var idClaim = context.Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(idClaim, out var userId))
            {
                context.Fail("El token no contiene una identidad válida.");
                return;
            }

            var db = context.HttpContext.RequestServices.GetRequiredService<PrevencionAccidentesBusesContext>();
            var currentUser = await db.Usuarios
                .WithoutDeletedAccounts()
                .AsNoTracking()
                .Where(user => user.IdUsuario == userId)
                .Select(user => new { user.Estado, user.TipoRol, user.UsuarioLogin })
                .SingleOrDefaultAsync(context.HttpContext.RequestAborted);

            if (currentUser is null || !string.Equals(currentUser.Estado, EstadosRegistro.Activo, StringComparison.Ordinal))
            {
                context.Fail("La cuenta ya no está activa.");
                return;
            }

            var expectedRole = UserAccounts.EffectiveRole(currentUser.UsuarioLogin, currentUser.TipoRol);
            var tokenRole = context.Principal?.FindFirst(ClaimTypes.Role)?.Value;
            if (!string.Equals(expectedRole, tokenRole, StringComparison.Ordinal))
            {
                context.Fail("Los permisos de la cuenta cambiaron; inicie sesión nuevamente.");
            }
        }
    };
});

// Configurar Rate Limiting para mitigar ataques de fuerza bruta en autenticación
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
    {
        var identity = httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? httpContext.Connection.RemoteIpAddress?.ToString()
            ?? "unknown";

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: identity,
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 300,
                Window = TimeSpan.FromMinutes(1),
                AutoReplenishment = true,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            });
    });
    options.AddPolicy("AuthRateLimit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
    options.AddPolicy("ChatRateLimit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? httpContext.Connection.RemoteIpAddress?.ToString()
                ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                AutoReplenishment = true,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
    options.AddPolicy("MapsRateLimit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? httpContext.Connection.RemoteIpAddress?.ToString()
                ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                AutoReplenishment = true,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
    options.AddPolicy("PublicReadRateLimit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Request.Cookies[PublicTripToken.GuestCookieName]
                ?? httpContext.Connection.RemoteIpAddress?.ToString()
                ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 180,
                Window = TimeSpan.FromMinutes(1),
                AutoReplenishment = true,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
    options.AddPolicy("PublicChatSessionRateLimit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromMinutes(1),
                AutoReplenishment = true,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
    options.AddPolicy("PublicChatReadRateLimit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Request.Cookies[PublicTripToken.GuestCookieName]
                ?? httpContext.Connection.RemoteIpAddress?.ToString()
                ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                AutoReplenishment = true,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
    options.AddPolicy("PublicChatWriteRateLimit", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Request.Cookies[PublicTripToken.GuestCookieName]
                ?? httpContext.Connection.RemoteIpAddress?.ToString()
                ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 6,
                Window = TimeSpan.FromMinutes(1),
                AutoReplenishment = true,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
});

// Configurar Forwarded Headers para Proxies Inversos (Nginx, Caddy, Cloudflare, IIS)
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
});

// Configuración dinámica de CORS
var configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? (builder.Environment.IsDevelopment()
        ? ["http://localhost:5173", "http://127.0.0.1:5173"]
        : ["https://transporteseunice.com", "https://www.transporteseunice.com"]);

if (!builder.Environment.IsDevelopment()
    && configuredOrigins.Any(origin => !origin.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
{
    throw new InvalidOperationException("Todos los orígenes CORS de producción deben usar HTTPS.");
}

builder.Services.AddCors(options =>
{
    options.AddPolicy("CorsPolicy", policy =>
    {
        policy.WithOrigins(configuredOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// Manejadores y Políticas de Autorización por Permisos
builder.Services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();
builder.Services.AddAuthorization(options =>
{
    foreach (var permission in AppPermissions.GetAllPermissions())
    {
        options.AddPolicy(permission, policy => 
            policy.Requirements.Add(new PermissionRequirement(permission)));
    }
});

var app = builder.Build();

// 1. Resolver primero el cliente y esquema originales desde el proxy de confianza.
app.UseForwardedHeaders();

// 2. Manejo global de excepciones
app.UseMiddleware<ApiExceptionMiddleware>();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["X-Frame-Options"] = "DENY";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), payment=()";
        return Task.CompletedTask;
    });
    await next();
});

// 3. OpenAPI en desarrollo
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// 4. CORS
app.UseCors("CorsPolicy");

// 5. Autenticación (necesaria antes de particionar límites por usuario)
app.UseAuthentication();
// A queued operation may outlive a browser account switch. This header only
// narrows the authenticated identity; it never grants access or selects an owner.
app.Use(async (context, next) => {
    if (context.User.Identity?.IsAuthenticated == true && context.Request.Headers.TryGetValue("X-Eunice-User", out var expected)
        && (!int.TryParse(expected.ToString(), out var expectedId) || expectedId.ToString() != context.User.FindFirstValue(ClaimTypes.NameIdentifier)))
    {
        context.Response.StatusCode = StatusCodes.Status409Conflict;
        await context.Response.WriteAsJsonAsync(new { codigo = "SESION_CAMBIADA", mensaje = "La sesión cambió. El archivo pendiente se conserva para su usuario original." });
        return;
    }
    await next();
});

// 6. Rate Limiting y autorización
app.UseRateLimiter();
app.UseAuthorization();

// 7. Mapeo de Controladores de API
app.MapGet("/health", async (PrevencionAccidentesBusesContext database, CancellationToken cancellationToken) =>
{
    try
    {
        return await database.Database.CanConnectAsync(cancellationToken)
            ? Results.Ok(new { status = "ok" })
            : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
    catch
    {
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
}).AllowAnonymous();

app.MapControllers();

// 8. Inicialización / Seeder Seguro de Base de Datos
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<PrevencionAccidentesBusesContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    if (builder.Configuration.GetValue("Database:ApplySchemaOnStartup", app.Environment.IsDevelopment()))
        await DatabaseSchemaInitializer.ApplyAsync(context, logger);
    else await DatabaseSchemaInitializer.ValidateAsync(context);
    await DatabaseSeeder.SeedAsync(context, builder.Configuration, logger, app.Environment.IsDevelopment());
}

// 9. WebSocket protegido (ver Core/LiveSocketEndpoint.cs)
app.MapLiveSocket(configuredOrigins, tokenValidationParameters);

app.Run();

public partial class Program;

