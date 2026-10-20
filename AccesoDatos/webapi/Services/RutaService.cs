using Microsoft.EntityFrameworkCore;
using AccesoDatos.Context;
using AccesoDatos.Models;
using webapi.Dtos;
using System.Data;

namespace webapi.Services
{
    public class RutaService : IRutaService
    {
        private readonly PrevencionAccidentesBusesContext _context;

        public RutaService(PrevencionAccidentesBusesContext context)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
        }

        public async Task<IEnumerable<RutaResponseDto>> GetRutasAsync()
        {
            return await _context.Ruta
                .AsNoTracking()
                .Select(route => new RutaResponseDto
                {
                    IdRuta = route.IdRuta,
                    NombreRuta = route.NombreRuta,
                    Origen = route.Origen,
                    Destino = route.Destino,
                    OrigenLatitud = route.OrigenLatitud,
                    OrigenLongitud = route.OrigenLongitud,
                    DestinoLatitud = route.DestinoLatitud,
                    DestinoLongitud = route.DestinoLongitud
                })
                .ToListAsync();
        }

        public async Task<RutaResponseDto?> GetRutaByIdAsync(int id)
        {
            return await _context.Ruta
                .AsNoTracking()
                .Where(route => route.IdRuta == id)
                .Select(route => new RutaResponseDto
                {
                    IdRuta = route.IdRuta,
                    NombreRuta = route.NombreRuta,
                    Origen = route.Origen,
                    Destino = route.Destino,
                    OrigenLatitud = route.OrigenLatitud,
                    OrigenLongitud = route.OrigenLongitud,
                    DestinoLatitud = route.DestinoLatitud,
                    DestinoLongitud = route.DestinoLongitud
                })
                .FirstOrDefaultAsync();
        }

        public async Task<RutaResponseDto> CrearRutaAsync(CrearRutaDto dto)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => CrearRutaTransactionalAsync(dto));
        }

        private async Task<RutaResponseDto> CrearRutaTransactionalAsync(CrearRutaDto dto)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var normalizedName = dto.NombreRuta.Trim();

            // Validar unicidad del nombre
            bool existeNombre = await _context.Ruta
                .AnyAsync(r => r.NombreRuta == normalizedName);

            if (existeNombre)
            {
                throw new InvalidOperationException($"El nombre de ruta '{normalizedName}' ya está registrado.");
            }

            var nuevaRuta = new Rutum
            {
                NombreRuta = normalizedName,
                Origen = dto.Origen.Trim(),
                Destino = dto.Destino.Trim(),
                OrigenLatitud = dto.OrigenLatitud,
                OrigenLongitud = dto.OrigenLongitud,
                DestinoLatitud = dto.DestinoLatitud,
                DestinoLongitud = dto.DestinoLongitud
            };

            _context.Ruta.Add(nuevaRuta);
            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return ToResponse(nuevaRuta);
        }

        public async Task<RutaResponseDto?> EditarRutaAsync(int id, EditarRutaDto dto)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => EditarRutaTransactionalAsync(id, dto));
        }

        private async Task<RutaResponseDto?> EditarRutaTransactionalAsync(int id, EditarRutaDto dto)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var ruta = await _context.Ruta.FirstOrDefaultAsync(r => r.IdRuta == id);
            if (ruta == null) return null;
            var normalizedName = dto.NombreRuta.Trim();

            // Validar unicidad si cambia el nombre
            if (!string.Equals(ruta.NombreRuta, normalizedName, StringComparison.OrdinalIgnoreCase))
            {
                bool existeNombre = await _context.Ruta
                    .AnyAsync(r => r.NombreRuta == normalizedName && r.IdRuta != id);

                if (existeNombre)
                {
                    throw new InvalidOperationException($"El nombre de ruta '{normalizedName}' ya está en uso por otra ruta.");
                }
            }

            ruta.NombreRuta = normalizedName;
            ruta.Origen = dto.Origen.Trim();
            ruta.Destino = dto.Destino.Trim();
            ruta.OrigenLatitud = dto.OrigenLatitud;
            ruta.OrigenLongitud = dto.OrigenLongitud;
            ruta.DestinoLatitud = dto.DestinoLatitud;
            ruta.DestinoLongitud = dto.DestinoLongitud;

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();
            return ToResponse(ruta);
        }

        private static RutaResponseDto ToResponse(Rutum route) => new()
        {
            IdRuta = route.IdRuta,
            NombreRuta = route.NombreRuta,
            Origen = route.Origen,
            Destino = route.Destino,
            OrigenLatitud = route.OrigenLatitud,
            OrigenLongitud = route.OrigenLongitud,
            DestinoLatitud = route.DestinoLatitud,
            DestinoLongitud = route.DestinoLongitud
        };

        public async Task<bool> EliminarRutaAsync(int id)
        {
            return await webapi.Core.DatabaseOperation.ExecuteAsync(_context, () => EliminarRutaTransactionalAsync(id));
        }

        private async Task<bool> EliminarRutaTransactionalAsync(int id)
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var ruta = await _context.Ruta.FirstOrDefaultAsync(r => r.IdRuta == id);
            if (ruta == null) return false;

            // Evitar caída por Constraint de Foreing Key en SQL Server
            bool tieneViajes = await _context.ViajesDiarios.AnyAsync(v => v.IdRuta == id);
            if (tieneViajes)
            {
                throw new InvalidOperationException("No se puede eliminar la ruta porque tiene viajes registrados.");
            }

            _context.Ruta.Remove(ruta);
            await _context.SaveChangesAsync();
            await transaction.CommitAsync();
            return true;
        }
    }
}
