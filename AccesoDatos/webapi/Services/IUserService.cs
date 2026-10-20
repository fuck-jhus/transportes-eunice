using webapi.Controllers; // Para usar UserResponseDto
using webapi.Dtos;

namespace webapi.Services
{
    public interface IUserService
    {
        Task<IEnumerable<UserResponseDto>> GetUsuariosAsync();
        Task<UserResponseDto?> GetUsuarioByIdAsync(int id);
        Task<UserResponseDto> CrearUsuarioAsync(CrearUsuarioDto dto);
        Task<UserResponseDto?> EditarUsuarioAsync(int id, EditarUsuarioDto dto);
        Task<bool> CambiarEstadoUsuarioAsync(int id, string nuevoEstado);
        Task<bool> EliminarUsuarioAsync(int id);
    }
}
