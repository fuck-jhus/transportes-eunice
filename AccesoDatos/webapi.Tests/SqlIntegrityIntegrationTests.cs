using System.Security.Claims;
using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using webapi.Core;
using webapi.Services;

namespace webapi.Tests;

// Opt-in only. Never infer production credentials from application settings.
public sealed class IsolatedSqlFactAttribute : FactAttribute
{
    public IsolatedSqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("EUNICE_SQL_TEST_CONNECTION")))
            Skip = "Requiere SQL Server LOCAL aislado y EUNICE_SQL_TEST_CONNECTION; InMemory no demuestra concurrencia ni RLS.";
    }
}

public class SqlIntegrityIntegrationTests
{
    [IsolatedSqlFact]
    public async Task SqlServer_PrecisionUniqueIdentityConcurrentFinishAndPooledRls()
    {
        var configured = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("EUNICE_SQL_TEST_CONNECTION"));
        Assert.Contains(configured.DataSource.ToLowerInvariant(), new[] { "localhost", "127.0.0.1", "localhost,1433", "127.0.0.1,1433", "(localdb)\\mssqllocaldb" });
        // Use a freshly generated database, never the database named in credentials.
        var database = "eunice_integrity_test_" + Guid.NewGuid().ToString("N");
        configured.InitialCatalog = "master"; configured.MultipleActiveResultSets = false;
        await using var master = new SqlConnection(configured.ConnectionString); await master.OpenAsync();
        await using (var create = master.CreateCommand()) { create.CommandText = $"CREATE DATABASE [{database}]"; await create.ExecuteNonQueryAsync(); }
        configured.InitialCatalog = database;
        var testConnection = configured.ConnectionString;
        var accessor = new HttpContextAccessor();
        PrevencionAccidentesBusesContext Context() => new(new DbContextOptionsBuilder<PrevencionAccidentesBusesContext>().UseSqlServer(testConnection)
            .AddInterceptors(new DatabaseSessionContextInterceptor(accessor)).Options);
        try
        {
            await using (var db = Context()) {
                await db.Database.EnsureCreatedAsync();
                // Match the original production schema, including its named UTC
                // default. ALTER COLUMN must preserve that default, not fail 5074.
                await db.Database.ExecuteSqlRawAsync("""
                    DECLARE @defaultName sysname, @dropSql nvarchar(max);
                    SELECT @defaultName=d.name FROM sys.default_constraints d
                    JOIN sys.columns c ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id
                    WHERE d.parent_object_id=OBJECT_ID(N'dbo.telemetria_iot') AND c.name=N'fecha_hora_servidor';
                    IF @defaultName IS NOT NULL
                    BEGIN
                        SET @dropSql=N'ALTER TABLE dbo.telemetria_iot DROP CONSTRAINT '+QUOTENAME(@defaultName);
                        EXEC sys.sp_executesql @dropSql;
                    END;
                    ALTER TABLE dbo.telemetria_iot ALTER COLUMN fecha_hora_servidor datetime NOT NULL;
                    ALTER TABLE dbo.telemetria_iot ADD CONSTRAINT DF_telemetria_servidor DEFAULT GETUTCDATE() FOR fecha_hora_servidor;
                    """);
                await DatabaseSchemaInitializer.ApplyAsync(db, NullLogger.Instance);
                // Exercise the production migration path on an older database without push.
                await db.Database.ExecuteSqlRawAsync("DROP TABLE dbo.dispositivo_push");
                await Assert.ThrowsAsync<InvalidOperationException>(() => DatabaseSchemaInitializer.ValidateAsync(db));
                using (var migration = typeof(DatabaseSchemaInitializer).Assembly.GetManifestResourceStream("webapi.Sql.20261016_integridad.sql")!)
                using (var reader = new StreamReader(migration))
                {
                    var sql = await reader.ReadToEndAsync();
                    await db.Database.ExecuteSqlRawAsync(sql);
                    await db.Database.ExecuteSqlRawAsync(sql); // Additive and safe to re-run.
                }
                using (var migration = typeof(DatabaseSchemaInitializer).Assembly.GetManifestResourceStream("webapi.Sql.20261017_push_operations.sql")!)
                using (var reader = new StreamReader(migration))
                {
                    var sql = await reader.ReadToEndAsync();
                    await db.Database.ExecuteSqlRawAsync(sql);
                    await db.Database.ExecuteSqlRawAsync(sql);
                }
                await DatabaseSchemaInitializer.ValidateAsync(db);
                var preservedDefault = await db.Database.SqlQueryRaw<string>("""
                    SELECT d.name AS [Value] FROM sys.default_constraints d
                    JOIN sys.columns c ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id
                    WHERE d.parent_object_id=OBJECT_ID(N'dbo.telemetria_iot') AND c.name=N'fecha_hora_servidor'
                    """).SingleAsync();
                Assert.Equal("DF_telemetria_servidor", preservedDefault);
                var preservedExpression = await db.Database.SqlQueryRaw<string>("""
                    SELECT d.definition AS [Value] FROM sys.default_constraints d
                    JOIN sys.columns c ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id
                    WHERE d.parent_object_id=OBJECT_ID(N'dbo.telemetria_iot') AND c.name=N'fecha_hora_servidor'
                    """).SingleAsync();
                Assert.Contains("getutcdate", preservedExpression, StringComparison.OrdinalIgnoreCase);
                Assert.Equal(1, await db.Database.SqlQueryRaw<int>("""
                    SELECT CASE WHEN system_type_id=TYPE_ID(N'datetime2') AND scale=7 AND is_nullable=1
                    THEN 1 ELSE 0 END AS [Value] FROM sys.columns
                    WHERE object_id=OBJECT_ID(N'dbo.telemetria_iot') AND name=N'fecha_hora_servidor'
                    """).SingleAsync());
                db.AddRange(new Usuario { IdUsuario = 0, NombreCompleto = "Piloto A", UsuarioLogin = "a", Contrasena = "fixture", TipoRol = "Piloto", Estado = "Activo" },
                    new Usuario { NombreCompleto = "Piloto B", UsuarioLogin = "b", Contrasena = "fixture", TipoRol = "Piloto", Estado = "Activo" },
                    new Autobus { Placa = "LOCAL-TEST", Estado = "Activo" }); await db.SaveChangesAsync();
                db.ViajesDiarios.Add(new ViajeDiario { IdUsuario = db.Usuarios.Single(x => x.UsuarioLogin == "a").IdUsuario,
                    IdAutobus = db.Autobuses.Single().IdAutobus, FechaInicio = DateTime.UtcNow.AddHours(-1), EstadoViaje = "En Curso" }); await db.SaveChangesAsync();
                await AssertDeletedAccountManagementAsync(db);
            }
            int trip, owner, other;
            await using (var db = Context()) { trip = db.ViajesDiarios.Single().IdViaje; owner = db.Usuarios.Single(x => x.UsuarioLogin == "a").IdUsuario; other = db.Usuarios.Single(x => x.UsuarioLogin == "b").IdUsuario; }
            var time = new DateTime(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc).AddMilliseconds(1);
            // Two independent SQL sessions bypass the process-local semaphore on purpose.
            async Task<bool> Insert() {
                await using var sql = new SqlConnection(testConnection); await sql.OpenAsync(); await using var command = sql.CreateCommand();
                command.CommandText = "INSERT dbo.telemetria_iot(id_viaje,id_lectura,latitud,longitud,velocidad_kmh,fecha_hora_dispositivo,sensores_calibrados) VALUES(@trip,'one-operation',15,-90,30,@time,0)";
                command.Parameters.AddWithValue("@trip", trip); command.Parameters.Add(new SqlParameter("@time", System.Data.SqlDbType.DateTime2) { Value = time });
                try { await command.ExecuteNonQueryAsync(); return true; } catch (SqlException ex) when (ex.Number is 2601 or 2627) { return false; }
            }
            var inserts = await Task.WhenAll(Insert(), Insert()); Assert.Single(inserts, x => x);
            await using (var db = Context()) { Assert.Equal(time, (await db.TelemetriaIots.SingleAsync()).FechaHoraDispositivo); }
            async Task<DateTime?> Finish() { await using var db = Context(); return (await new ViajeService(db).FinalizarViajeAsync(trip))!.FechaFin; }
            var finishes = await Task.WhenAll(Finish(), Finish()); Assert.Equal(finishes[0], finishes[1]);
            await using (var db = Context()) {
                using var stream = typeof(DatabaseSchemaInitializer).Assembly.GetManifestResourceStream("webapi.Sql.20261016_rls.sql")!;
                using var reader = new StreamReader(stream); await db.Database.ExecuteSqlRawAsync(await reader.ReadToEndAsync());
            }
            void Principal(int? id, string role) => accessor.HttpContext = new DefaultHttpContext { User = id.HasValue
                ? new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, id.ToString()!), new Claim(ClaimTypes.Role, role)], "fixture")) : new ClaimsPrincipal() };
            Principal(owner, "Piloto"); await using (var db = Context()) Assert.Single(await db.TelemetriaIots.ToListAsync());
            Principal(other, "Piloto"); await using (var db = Context()) Assert.Empty(await db.TelemetriaIots.ToListAsync());
            Principal(null, "Anonymous"); await using (var db = Context()) Assert.Empty(await db.TelemetriaIots.ToListAsync());
            Principal(owner, "Administrador"); await using (var db = Context()) Assert.Single(await db.TelemetriaIots.ToListAsync());
            // Owner A -> B -> anonymous -> staff uses the same pooled connection configuration.
        }
        finally
        {
            accessor.HttpContext = null;
            using var pool = new SqlConnection(testConnection); SqlConnection.ClearPool(pool);
            // Exact database generated above. No user database or wildcard is targeted.
            Assert.StartsWith("eunice_integrity_test_", database);
            await using var drop = master.CreateCommand(); drop.CommandText = $"ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}]"; await drop.ExecuteNonQueryAsync();
        }
    }

    private static async Task AssertDeletedAccountManagementAsync(PrevencionAccidentesBusesContext db)
    {
        var user = new Usuario { NombreCompleto = "Titular", UsuarioLogin = "delete-from-mobile", Contrasena = "fixture", TipoRol = "Administrador", Estado = "Activo" };
        var suspended = new Usuario { NombreCompleto = "Suspendido", UsuarioLogin = "deletedXregular", Contrasena = "fixture", TipoRol = "Piloto", Estado = "Inactivo" };
        db.AddRange(user, suspended);
        await db.SaveChangesAsync();
        db.MensajesChat.Add(new MensajeChat
        {
            IdMensaje = Guid.NewGuid(), IdEmisor = user.IdUsuario, NombreEmisor = user.NombreCompleto,
            RolEmisor = user.TipoRol, NombrePilotoCanal = "General", Contenido = "Historial del titular",
            FechaHora = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        var service = new UserService(db);
        Assert.True(await service.EliminarUsuarioAsync(user.IdUsuario));
        Assert.True(await db.Usuarios.AnyAsync(item => item.IdUsuario == user.IdUsuario));
        Assert.Null(await service.GetUsuarioByIdAsync(user.IdUsuario));
        var managed = (await service.GetUsuariosAsync()).ToList();
        Assert.DoesNotContain(managed, item => item.IdUsuario == user.IdUsuario);
        Assert.Contains(managed, item => item.IdUsuario == suspended.IdUsuario);
        Assert.False(await service.CambiarEstadoUsuarioAsync(user.IdUsuario, "Activo"));
        Assert.Null(await service.EditarUsuarioAsync(user.IdUsuario, new webapi.Dtos.EditarUsuarioDto
        {
            NombreCompleto = "Restaurada", UsuarioLogin = "restore-mobile", TipoRol = "Administrador", Estado = "Activo"
        }));
        Assert.True(await service.CambiarEstadoUsuarioAsync(suspended.IdUsuario, "Activo"));
        Assert.Equal("Cuenta eliminada", (await db.MensajesChat.SingleAsync(message => message.IdEmisor == user.IdUsuario)).NombreEmisor);
    }
}
