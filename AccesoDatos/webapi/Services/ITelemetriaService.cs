using System.Collections.Generic;
using System.Threading.Tasks;
using webapi.Dtos;

namespace webapi.Services
{
    public interface ITelemetriaService
    {
        Task<int> RegistrarTelemetriaAsync(int idPiloto, CrearTelemetriaDto dto);
        Task<int> RegistrarTelemetriaBatchAsync(int idPiloto, IEnumerable<CrearTelemetriaDto> dtos);
        Task<TelemetryBatchReceipt> RegistrarDeliveryAsync(int idPiloto, IReadOnlyList<CrearTelemetriaDto> dtos);
        Task ActualizarEstadoPilotoAsync(int idPiloto, bool isPrivacyMode);
        Task<IEnumerable<AlertaResponseDto>> GetAlertasRecientesAsync(DateTime? inicio = null, DateTime? fin = null);
        Task<IEnumerable<AlertaResponseDto>> GetAlertasHistoricasAsync(DateTime? fechaInicio, DateTime? fechaFin, int? idUsuario, string? tipoAlerta);
        Task<EstadisticasAlertasDto> GetEstadisticasAlertasAsync(DateTime? inicio = null, DateTime? fin = null);
    }
}
