using AccesoDatos.Context;
using Microsoft.EntityFrameworkCore;

namespace webapi.Core;

public static class DatabaseOperation
{
    public static Task<T> ExecuteAsync<T>(PrevencionAccidentesBusesContext db, Func<Task<T>> action)
    {
        var attempt = 0;
        return db.Database.CreateExecutionStrategy().ExecuteAsync(() => {
            if (attempt++ > 0) db.ChangeTracker.Clear(); // A rolled-back insert/update must not survive a deadlock retry.
            return action();
        });
    }
    public static async Task ExecuteAsync(PrevencionAccidentesBusesContext db, Func<Task> action) =>
        await ExecuteAsync(db, async () => { await action(); return true; });
}
