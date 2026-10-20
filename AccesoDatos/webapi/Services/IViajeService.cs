using System.Collections.Generic;
using System.Threading.Tasks;
using webapi.Dtos;

namespace webapi.Services
{
    public interface IViajeService
    {
        Task<IEnumerable<ViajeResponseDto>> GetViajesAsync(string? estado = null, int? idUsuario = null);
        Task<ViajeResponseDto?> GetViajeByIdAsync(int id, int? idUsuario = null);
        Task<ViajeResponseDto?> GetViajeActivoPorPilotoAsync(int idPiloto);
        Task<ViajeResponseDto> CrearViajeAsync(CrearViajeDto dto);
        Task<ViajeResponseDto?> GuardarRutaEnViajeAsync(int id, GuardarRutaViajeDto dto, int? idPilotoPropietario = null);
        Task<ViajeResponseDto?> FinalizarViajeAsync(int id, int? idPilotoPropietario = null);
    }
}
