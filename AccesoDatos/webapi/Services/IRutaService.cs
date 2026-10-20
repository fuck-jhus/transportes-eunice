using webapi.Dtos;

namespace webapi.Services
{
    public interface IRutaService
    {
        Task<IEnumerable<RutaResponseDto>> GetRutasAsync();
        Task<RutaResponseDto?> GetRutaByIdAsync(int id);
        Task<RutaResponseDto> CrearRutaAsync(CrearRutaDto dto);
        Task<RutaResponseDto?> EditarRutaAsync(int id, EditarRutaDto dto);
        Task<bool> EliminarRutaAsync(int id);
    }
}
