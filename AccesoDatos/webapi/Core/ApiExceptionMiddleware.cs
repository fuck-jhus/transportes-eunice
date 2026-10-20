using System.Net;
using System.Text.Json;

namespace webapi.Core
{
    public class ApiExceptionMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<ApiExceptionMiddleware> _logger;
        private readonly IHostEnvironment _env;

        public ApiExceptionMiddleware(RequestDelegate next, ILogger<ApiExceptionMiddleware> logger, IHostEnvironment env)
        {
            _next = next ?? throw new ArgumentNullException(nameof(next));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _env = env ?? throw new ArgumentNullException(nameof(env));
        }

        public async Task InvokeAsync(HttpContext context)
        {
            try
            {
                await _next(context);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Excepción no controlada durante la petición HTTP {Method} {Path}", context.Request.Method, context.Request.Path);
                await HandleExceptionAsync(context, ex);
            }
        }

        private Task HandleExceptionAsync(HttpContext context, Exception exception)
        {
            if (context.Response.HasStarted)
            {
                _logger.LogWarning("La respuesta ya había comenzado al capturar la excepción.");
                return Task.CompletedTask;
            }

            context.Response.ContentType = "application/json";
            
            var statusCode = exception switch
            {
                UnauthorizedAccessException => HttpStatusCode.Unauthorized,
                InvalidOperationException => HttpStatusCode.BadRequest,
                KeyNotFoundException => HttpStatusCode.NotFound,
                _ => HttpStatusCode.InternalServerError
            };

            context.Response.StatusCode = (int)statusCode;

            object responseBody;
            if (_env.IsDevelopment())
            {
                responseBody = new
                {
                    mensaje = statusCode == HttpStatusCode.InternalServerError 
                        ? "Ocurrió un error interno en el servidor." 
                        : exception.Message,
                    detalle = exception.Message,
                    tipo = exception.GetType().Name,
                    stackTrace = exception.StackTrace
                };
            }
            else
            {
                responseBody = new
                {
                    mensaje = statusCode == HttpStatusCode.InternalServerError 
                        ? "Ocurrió un error interno en el servidor." 
                        : exception.Message
                };
            }

            var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            var json = JsonSerializer.Serialize(responseBody, options);
            return context.Response.WriteAsync(json);
        }
    }
}
