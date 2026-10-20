using System.Collections.Generic;
using System.Threading.Tasks;
using webapi.Dtos;

namespace webapi.Services
{
    public interface IEvaluacionService
    {
        Task ProcesarEvaluacionesMensualesAsync(int anio, int mes);
        Task<IEnumerable<EvaluacionResponseDto>> GetEvaluacionesMensualesAsync(int? anio, int? mes);
    }
}
