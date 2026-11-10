using webapi.Core;

namespace webapi.Tests;

public class DomainRulesTests
{
    [Theory]
    [InlineData("superadmin", "Administrador", "SuperAdministrador")]
    [InlineData("SuperAdmin ", "Administrador", "SuperAdministrador")]
    [InlineData("superadmin2", "Administrador", "Administrador")]
    [InlineData("pilot", "Piloto", "Piloto")]
    [InlineData("pilot", null, "")]
    public void EffectiveRole_ElevatesOnlyTheProtectedAccount(string login, string? stored, string expected) =>
        Assert.Equal(expected, UserAccounts.EffectiveRole(login, stored));

    [Fact]
    public void RoleCombinations_MatchTheAuthorizeAttributeFormat()
    {
        Assert.Equal("Administrador,SuperAdministrador", RolesUsuario.Administradores);
        Assert.Equal("Administrador,SuperAdministrador,Supervisor", RolesUsuario.Operadores);
        Assert.Equal("Piloto,Administrador,SuperAdministrador", RolesUsuario.PilotosYAdministradores);
        Assert.Equal("Piloto,Administrador,SuperAdministrador,Supervisor", RolesUsuario.Todos);
        Assert.Equal(RolesUsuario.Todos, string.Join(",", RolesUsuario.ListaTodos));
    }

    [Fact]
    public async Task AlertThresholds_ComeFromConfiguration()
    {
        await using var db = TestDb.Create();
        db.AddRange(new AccesoDatos.Models.Usuario { IdUsuario = 1, NombreCompleto = "Piloto", UsuarioLogin = "pilot", TipoRol = RolesUsuario.Piloto, Estado = EstadosRegistro.Activo, Contrasena = "fixture" },
            new AccesoDatos.Models.Autobus { IdAutobus = 1, Placa = "FIX-001", Estado = EstadosRegistro.Activo });
        db.ViajesDiarios.Add(new AccesoDatos.Models.ViajeDiario { IdViaje = 1, IdUsuario = 1, IdAutobus = 1, FechaInicio = DateTime.UtcNow.AddHours(-1), EstadoViaje = EstadosViaje.EnCurso });
        await db.SaveChangesAsync();

        // 70 km/h no supera el límite por defecto (80), pero sí uno configurado de 60.
        var limits = Microsoft.Extensions.Options.Options.Create(new AlertThresholds { VelocidadMaximaKmh = 60 });
        await new webapi.Services.TelemetriaService(db, thresholds: limits).RegistrarTelemetriaAsync(1, new webapi.Dtos.CrearTelemetriaDto
        {
            IdViaje = 1, IdLectura = "r1", FechaHoraDispositivo = DateTime.UtcNow.AddSeconds(-5),
            Latitud = 15, Longitud = -90, VelocidadKmh = 70, PrecisionMetros = 5
        });

        var alert = Assert.Single(db.AlertaRiesgos);
        Assert.Equal("Exceso de Velocidad", alert.TipoAlerta);
        Assert.Equal(60, alert.LimitePermitido);
    }

    [Fact]
    public void AlertThresholds_RejectNonsenseValues()
    {
        Assert.Throws<InvalidOperationException>(() => new AlertThresholds { VelocidadMaximaKmh = 0 }.Validate());
        Assert.Throws<InvalidOperationException>(() => new AlertThresholds { FrenadoBruscoMs2 = -3 }.Validate());
        new AlertThresholds().Validate();
    }
}
