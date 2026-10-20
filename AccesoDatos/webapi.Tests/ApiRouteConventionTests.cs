using Microsoft.AspNetCore.Mvc;
using webapi.Controllers;
using webapi.Core;

namespace webapi.Tests;

public class ApiRouteConventionTests
{
    [Fact]
    public void EveryController_ExposesOneCanonicalApiRoute()
    {
        var controllerTypes = typeof(AuthController).Assembly
            .GetTypes()
            .Where(type => !type.IsAbstract && typeof(ControllerBase).IsAssignableFrom(type))
            .OrderBy(type => type.Name)
            .ToArray();

        Assert.NotEmpty(controllerTypes);

        foreach (var controllerType in controllerTypes)
        {
            var routes = controllerType
                .GetCustomAttributes(typeof(RouteAttribute), inherit: true)
                .Cast<RouteAttribute>()
                .Select(attribute => attribute.Template)
                .ToArray();

            var route = Assert.Single(routes);
            Assert.NotNull(route);
            Assert.StartsWith(ApiRoutes.Prefix + "/", route, StringComparison.Ordinal);
            Assert.Equal(route, route!.ToLowerInvariant());
            Assert.DoesNotContain("[controller]", route, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void CanonicalRoutes_AreStableAndExplicit()
    {
        var routes = new[]
        {
            ApiRoutes.Alertas,
            ApiRoutes.Auth,
            ApiRoutes.Autobuses,
            ApiRoutes.Chat,
            ApiRoutes.Evaluaciones,
            ApiRoutes.Mapas,
            ApiRoutes.Rutas,
            ApiRoutes.Telemetria,
            ApiRoutes.Usuarios,
            ApiRoutes.Viajes,
            ApiRoutes.ConversacionesPasajeros,
            ApiRoutes.ViajesPublicos
        };

        Assert.All(routes, route =>
        {
            Assert.StartsWith("api/", route, StringComparison.Ordinal);
            Assert.False(route.EndsWith('/'));
            Assert.Equal(route, route.ToLowerInvariant());
        });

        Assert.Equal(routes.Length, routes.Distinct(StringComparer.Ordinal).Count());
    }
}
