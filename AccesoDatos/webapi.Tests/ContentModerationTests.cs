using webapi.Core;

namespace webapi.Tests;

public class ContentModerationTests
{
    [Theory]
    [InlineData("Mensaje operativo normal")]
    [InlineData("Precaución por lluvia en ruta")]
    public void AllowsOperationalContent(string content)
    {
        Assert.True(ContentModeration.IsAllowed(content));
    }

    [Theory]
    [InlineData("Eres un idiota")]
    [InlineData("contenido pornográfico")]
    [InlineData("KILL YOURSELF")]
    public void BlocksConfiguredUnsafeContent(string content)
    {
        Assert.False(ContentModeration.IsAllowed(content));
    }
}
