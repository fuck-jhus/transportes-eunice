using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace webapi.Core;
public sealed class OperationConflictException() : Exception("El identificador de operación ya corresponde a otra acción.");

public static class DatabaseConflicts
{
    public static bool IsConflict(Exception error) => error is DbUpdateConcurrencyException or TrackingSourceConflictException or OperationConflictException
        || error is SqlException { Number: 2601 or 2627 or 1205 or 51010 }
        || error is DbUpdateException { InnerException: SqlException { Number: 2601 or 2627 or 1205 } };
    public const string Message = "La operación entró en conflicto con otro cambio o ya existe. Recarga los datos y vuelve a intentar; no se creó un duplicado.";
}
