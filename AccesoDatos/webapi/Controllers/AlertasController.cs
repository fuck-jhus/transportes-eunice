using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using webapi.Services;
using webapi.Core;

namespace webapi.Controllers
{
    [ApiController]
    [Route(ApiRoutes.Alertas)]
    [Authorize]
    public class AlertasController : ControllerBase
    {
        private readonly ITelemetriaService _telemetriaService;
        private readonly ILogger<AlertasController> _logger;

        public AlertasController(ITelemetriaService telemetriaService, ILogger<AlertasController> logger)
        {
            _telemetriaService = telemetriaService ?? throw new ArgumentNullException(nameof(telemetriaService));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpGet]
        [HasPermission(AppPermissions.Telemetria.Consultar)]
        public async Task<IActionResult> GetAlertas([FromQuery] int? anio = null, [FromQuery] int? mes = null)
        {
            try
            {
                if (anio.HasValue != mes.HasValue || mes is < 1 or > 12 || anio is < 2000 or > 2100) return BadRequest();
                var period = anio.HasValue ? ObservationCoverage.Month(anio.Value, mes!.Value) : ((DateTime Start, DateTime End)?)null;
                var alertas = await _telemetriaService.GetAlertasRecientesAsync(period?.Start, period?.End);
                return Ok(alertas);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener alertas de riesgo.");
                return StatusCode(500, new { mensaje = "Error al obtener alertas de riesgo." });
            }
        }

        [HttpGet("historico")]
        [HasPermission(AppPermissions.Telemetria.Consultar)]
        public async Task<IActionResult> GetHistorico(
            [FromQuery] DateTime? fechaInicio,
            [FromQuery] DateTime? fechaFin,
            [FromQuery] int? idUsuario,
            [FromQuery] string? tipoAlerta)
        {
            try
            {
                var alertas = (await _telemetriaService.GetAlertasHistoricasAsync(fechaInicio, fechaFin, idUsuario, tipoAlerta)).ToList();
                return Ok(alertas);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener el historial de alertas.");
                return StatusCode(500, new { mensaje = "Error al obtener el historial de alertas." });
            }
        }

        [HttpGet("estadisticas")]
        [HasPermission(AppPermissions.Telemetria.Consultar)]
        public async Task<IActionResult> GetEstadisticas([FromQuery] int? anio = null, [FromQuery] int? mes = null)
        {
            try
            {
                if (anio.HasValue != mes.HasValue || mes is < 1 or > 12 || anio is < 2000 or > 2100) return BadRequest();
                var period = anio.HasValue ? ObservationCoverage.Month(anio.Value, mes!.Value) : ((DateTime Start, DateTime End)?)null;
                var stats = await _telemetriaService.GetEstadisticasAlertasAsync(period?.Start, period?.End);
                return Ok(stats);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al obtener estadísticas de alertas.");
                return StatusCode(500, new { mensaje = "Error al obtener estadísticas de alertas." });
            }
        }

        [HttpGet("exportar/excel")]
        [HasPermission(AppPermissions.Telemetria.Consultar)]
        public async Task<IActionResult> ExportarExcel(
            [FromQuery] DateTime? fechaInicio,
            [FromQuery] DateTime? fechaFin,
            [FromQuery] int? idUsuario,
            [FromQuery] string? tipoAlerta)
        {
            try
            {
                var alertas = await _telemetriaService.GetAlertasHistoricasAsync(fechaInicio, fechaFin, idUsuario, tipoAlerta);
                
                var sb = new StringBuilder();
                // Escribir el BOM de UTF-8 para compatibilidad con Excel
                sb.Append('\uFEFF');
                
                // Encabezados
                sb.AppendLine("ID Alerta,Fecha y Hora,Tipo Alerta,Piloto,Autobús,Ruta,Valor Registrado,Límite Permitido");
                
                foreach (var a in alertas)
                {
                    sb.AppendLine($"{a.IdAlerta},{a.FechaHora:yyyy-MM-dd HH:mm:ss},{EscaparCsv(a.TipoAlerta)},{EscaparCsv(a.NombrePiloto)},{EscaparCsv(a.PlacaAutobus)},{EscaparCsv(a.NombreRuta)},{a.ValorRegistrado.ToString(CultureInfo.InvariantCulture)},{a.LimitePermitido?.ToString(CultureInfo.InvariantCulture)}");
                }
                
                var bytes = Encoding.UTF8.GetBytes(sb.ToString());
                return File(bytes, "text/csv; charset=utf-8", "reporte_alertas.csv");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al exportar reporte de alertas a Excel.");
                return StatusCode(500, new { mensaje = "Error al exportar reporte de alertas a Excel." });
            }
        }

        [HttpGet("exportar/pdf")]
        [HasPermission(AppPermissions.Telemetria.Consultar)]
        public async Task<IActionResult> ExportarPdf(
            [FromQuery] DateTime? fechaInicio,
            [FromQuery] DateTime? fechaFin,
            [FromQuery] int? idUsuario,
            [FromQuery] string? tipoAlerta)
        {
            try
            {
                var alertas = (await _telemetriaService.GetAlertasHistoricasAsync(fechaInicio, fechaFin, idUsuario, tipoAlerta)).ToList();

                // Crear documento PDF
                using var document = new PdfSharp.Pdf.PdfDocument();
                document.Info.Title = "Reporte de Alertas de Riesgo";
                document.Info.Author = "Sistema de Control de Telemetría";

                // Fuentes estándar
                var titleFont = new PdfSharp.Drawing.XFont("Arial", 16, PdfSharp.Drawing.XFontStyleEx.Bold);
                var headerFont = new PdfSharp.Drawing.XFont("Arial", 10, PdfSharp.Drawing.XFontStyleEx.Bold);
                var regularFont = new PdfSharp.Drawing.XFont("Arial", 9, PdfSharp.Drawing.XFontStyleEx.Regular);
                var pen = new PdfSharp.Drawing.XPen(PdfSharp.Drawing.XColors.LightGray, 1);
                const int rowsPerPage = 31;
                var totalPages = Math.Max(1, (int)Math.Ceiling(alertas.Count / (double)rowsPerPage));
                var generatedAt = DateTime.UtcNow;

                for (var pageIndex = 0; pageIndex < totalPages; pageIndex++)
                {
                    var page = document.AddPage();
                    page.Size = PdfSharp.PageSize.A4;
                    page.Orientation = PdfSharp.PageOrientation.Portrait;
                    using var gfx = PdfSharp.Drawing.XGraphics.FromPdfPage(page);

                    gfx.DrawString("REPORTE DE ALERTAS DE RIESGO", titleFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(40, 50));
                    gfx.DrawString($"Fecha del Reporte (UTC): {generatedAt:yyyy-MM-dd HH:mm:ss}", regularFont, PdfSharp.Drawing.XBrushes.DarkGray, new PdfSharp.Drawing.XPoint(40, 70));
                    gfx.DrawString($"Cantidad de Infracciones: {alertas.Count}", regularFont, PdfSharp.Drawing.XBrushes.DarkGray, new PdfSharp.Drawing.XPoint(40, 85));
                    gfx.DrawLine(pen, 40, 100, 550, 100);

                    const int startY = 120;
                    gfx.DrawString("Fecha / Hora", headerFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(40, startY));
                    gfx.DrawString("Alerta", headerFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(150, startY));
                    gfx.DrawString("Piloto", headerFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(270, startY));
                    gfx.DrawString("Placa", headerFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(390, startY));
                    gfx.DrawString("Valor", headerFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(460, startY));
                    gfx.DrawString("Límite", headerFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(510, startY));
                    gfx.DrawLine(pen, 40, startY + 5, 550, startY + 5);

                    var currentY = startY + 20;
                    foreach (var alerta in alertas.Skip(pageIndex * rowsPerPage).Take(rowsPerPage))
                    {
                        gfx.DrawString($"{alerta.FechaHora:yyyy-MM-dd HH:mm}", regularFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(40, currentY));
                        gfx.DrawString(Acortar(alerta.TipoAlerta, 20), regularFont, PdfSharp.Drawing.XBrushes.DarkRed, new PdfSharp.Drawing.XPoint(150, currentY));
                        gfx.DrawString(Acortar(alerta.NombrePiloto, 22), regularFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(270, currentY));
                        gfx.DrawString(Acortar(alerta.PlacaAutobus, 12), regularFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(390, currentY));
                        gfx.DrawString(alerta.ValorRegistrado.ToString(CultureInfo.InvariantCulture), regularFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(460, currentY));
                        gfx.DrawString(alerta.LimitePermitido?.ToString(CultureInfo.InvariantCulture) ?? "—", regularFont, PdfSharp.Drawing.XBrushes.Black, new PdfSharp.Drawing.XPoint(510, currentY));
                        currentY += 20;
                    }

                    gfx.DrawLine(pen, 40, 790, 550, 790);
                    gfx.DrawString($"Página {pageIndex + 1} de {totalPages}", regularFont, PdfSharp.Drawing.XBrushes.DarkGray, new PdfSharp.Drawing.XPoint(470, 810));
                }

                using var stream = new MemoryStream();
                document.Save(stream, false);
                var bytes = stream.ToArray();

                return File(bytes, "application/pdf", "reporte_alertas.pdf");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al generar el reporte PDF de alertas.");
                return StatusCode(500, new { mensaje = "Error al generar el reporte PDF." });
            }
        }

        private static string EscaparCsv(string val)
        {
            if (string.IsNullOrEmpty(val)) return string.Empty;

            // Excel interpreta estos prefijos como fórmulas incluso dentro de un CSV.
            // Anteponer una comilla simple conserva el texto y evita CSV injection.
            if (val[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
            {
                val = "'" + val;
            }

            if (val.Contains(',') || val.Contains('"') || val.Contains('\n') || val.Contains('\r'))
            {
                return "\"" + val.Replace("\"", "\"\"") + "\"";
            }
            return val;
        }

        private static string Acortar(string str, int maxLen)
        {
            if (string.IsNullOrEmpty(str)) return string.Empty;
            return str.Length <= maxLen ? str : str.Substring(0, maxLen - 3) + "...";
        }
    }
}
