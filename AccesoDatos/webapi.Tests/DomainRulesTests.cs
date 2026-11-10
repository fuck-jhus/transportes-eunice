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
}
