using AccesoDatos.Context;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace webapi.Tests;

internal static class TestDb
{
    public static PrevencionAccidentesBusesContext Create(string? name = null)
    {
        var options = new DbContextOptionsBuilder<PrevencionAccidentesBusesContext>()
            .UseInMemoryDatabase(name ?? Guid.NewGuid().ToString())
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new PrevencionAccidentesBusesContext(options);
    }
}
