using webapi.Dtos;

namespace webapi.Services
{
    public interface IAutobusService
    {
        Task<IEnumerable<AutobusResponseDto>> GetAutobusesAsync();
        Task<AutobusResponseDto?> GetAutobusByIdAsync(int id);
        Task<AutobusResponseDto> CrearAutobusAsync(CrearAutobusDto dto);
        Task<AutobusResponseDto?> EditarAutobusAsync(int id, EditarAutobusDto dto);
        Task<bool> EliminarAutobusAsync(int id);
    }
}
