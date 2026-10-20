using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using webapi.Core;

namespace webapi.Tests;

public class PermissionAuthorizationTests
{
    [Fact]
    public async Task PermissionClaim_GrantsRequestedPermission()
    {
        var principal = CreatePrincipal(
            new Claim("Permission", AppPermissions.Viajes.Consultar),
            new Claim(ClaimTypes.Role, "Piloto"));
        var requirement = new PermissionRequirement(AppPermissions.Viajes.Consultar);
        var context = new AuthorizationHandlerContext([requirement], principal, null);

        await new PermissionAuthorizationHandler().HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public async Task PilotWithoutPermission_IsDenied()
    {
        var principal = CreatePrincipal(new Claim(ClaimTypes.Role, "Piloto"));
        var requirement = new PermissionRequirement(AppPermissions.Usuarios.Consultar);
        var context = new AuthorizationHandlerContext([requirement], principal, null);

        await new PermissionAuthorizationHandler().HandleAsync(context);

        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public async Task RoleMapping_GrantsPermissionToLegacyTokenWithoutPermissionClaims()
    {
        var principal = CreatePrincipal(new Claim(ClaimTypes.Role, "Administrador"));
        var requirement = new PermissionRequirement(AppPermissions.Telemetria.Consultar);
        var context = new AuthorizationHandlerContext([requirement], principal, null);

        await new PermissionAuthorizationHandler().HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public async Task SuperAdministrator_HasAllPermissions()
    {
        var principal = CreatePrincipal(new Claim(ClaimTypes.Role, "SuperAdministrador"));
        var requirement = new PermissionRequirement(AppPermissions.Usuarios.Eliminar);
        var context = new AuthorizationHandlerContext([requirement], principal, null);

        await new PermissionAuthorizationHandler().HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public void PilotRole_CanFinalizeOwnTrip()
    {
        Assert.Contains(
            AppPermissions.Viajes.Finalizar,
            AppPermissions.GetPermissionsForRole("Piloto"));
    }

    [Fact]
    public void PilotRole_CanReadRoutesButCannotManageGlobalCatalog()
    {
        var permissions = AppPermissions.GetPermissionsForRole("Piloto");

        Assert.Contains(AppPermissions.Rutas.Consultar, permissions);
        Assert.DoesNotContain(AppPermissions.Rutas.Crear, permissions);
        Assert.DoesNotContain(AppPermissions.Rutas.Editar, permissions);
        Assert.DoesNotContain(AppPermissions.Rutas.Eliminar, permissions);
    }

    [Fact]
    public void SuperAdministratorRole_ContainsEveryPermission()
    {
        Assert.Equal(
            AppPermissions.GetAllPermissions().Order(),
            AppPermissions.GetPermissionsForRole("SuperAdministrador").Order());
    }

    private static ClaimsPrincipal CreatePrincipal(params Claim[] claims) =>
        new(new ClaimsIdentity(claims, "Test"));
}
