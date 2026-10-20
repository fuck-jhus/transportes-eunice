using System.Net;
using System.Security.Cryptography;
using AccesoDatos.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using webapi.Core;
using webapi.Services;

namespace webapi.Tests;

public class GuestWebPushTests
{
    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/valid", true)]
    [InlineData("https://web.push.apple.com/valid", true)]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/valid", true)]
    [InlineData("https://127.0.0.1/admin", false)]
    [InlineData("http://fcm.googleapis.com/test", false)]
    [InlineData("https://fcm.googleapis.com.attacker.test/test", false)]
    [InlineData("https://fcm.googleapis.com:8443/test", false)]
    [InlineData("https://secret@fcm.googleapis.com/test", false)]
    public void Subscription_OnlyAllowsKnownHttpsPushProviders(string endpoint, bool valid) =>
        Assert.Equal(valid, GuestWebPushService.ValidEndpoint(endpoint));

    [Fact]
    public async Task Keys_AreStableAndPrivateMaterialIsProtected()
    {
        await using var db = TestDb.Create();
        var service = new GuestWebPushService(db, new EphemeralDataProtectionProvider(), new Provider());
        var first = await service.GetKeysAsync(); var second = await service.GetKeysAsync();
        Assert.Equal(first.PublicKey, second.PublicKey); Assert.Single(db.GuestPushKeyRing);
        Assert.Equal(65, WebEncoders.Base64UrlDecode(first.PublicKey).Length);
        Assert.DoesNotContain(first.PublicKey, first.ProtectedPrivateKey);
        Assert.False(GuestWebPushService.ValidKeys(first.PublicKey, "bad-key"));
    }

    [Fact]
    public async Task Reply_IsEncryptedAndStopsAfterRevocationOrSubscriptionReplacement()
    {
        await using var db = TestDb.Create();
        var now = DateTime.UtcNow; var token = PublicTripToken.Create();
        var user = new Usuario { NombreCompleto = "Pilot", UsuarioLogin = "test", Contrasena = "fixture", TipoRol = "Piloto", Estado = "Activo" };
        var bus = new Autobus { Placa = "TEST", Estado = "Activo" };
        var trip = new ViajeDiario { IdUsuarioNavigation = user, IdAutobusNavigation = bus, FechaInicio = now, EstadoViaje = "En Curso" };
        var access = new ViajeAccesoPublico { IdAcceso = Guid.NewGuid(), IdViajeNavigation = trip,
            TokenHash = PublicTripToken.Hash(token), FechaCreacion = now, FechaExpiracion = now.AddHours(1), ChatHabilitado = true };
        var conversation = new ConversacionPasajero { IdConversacion = Guid.NewGuid(), IdAccesoNavigation = access,
            SesionHash = PublicTripToken.Hash(PublicTripToken.Create()), AliasPasajero = "Pasajero", FechaCreacion = now, FechaUltimaActividad = now };
        db.ConversacionesPasajeros.Add(conversation); await db.SaveChangesAsync();
        var provider = new Provider(); var service = new GuestWebPushService(db, new EphemeralDataProtectionProvider(), provider);
        var (publicKey, auth) = ClientKeys();
        await service.SubscribeAsync(conversation.IdConversacion, token, access.FechaExpiracion, "https://fcm.googleapis.com/fcm/send/one", publicKey, auth);
        await GuestWebPushService.QueueReplyAsync(db, conversation.IdConversacion, Guid.NewGuid()); await db.SaveChangesAsync();
        await service.ProcessAsync(DateTime.UtcNow);
        Assert.Equal(1, provider.Requests); Assert.True(provider.Encrypted);
        Assert.Equal("Delivered", db.GuestPushJobs.Single().Status);

        await GuestWebPushService.QueueReplyAsync(db, conversation.IdConversacion, Guid.NewGuid()); await db.SaveChangesAsync();
        await service.SubscribeAsync(conversation.IdConversacion, token, access.FechaExpiracion, "https://fcm.googleapis.com/fcm/send/two", publicKey, auth);
        await service.ProcessAsync(DateTime.UtcNow); Assert.Equal(1, provider.Requests);
        await GuestWebPushService.QueueReplyAsync(db, conversation.IdConversacion, Guid.NewGuid()); await db.SaveChangesAsync();
        access.FechaRevocacion = DateTime.UtcNow; await db.SaveChangesAsync();
        await service.ProcessAsync(DateTime.UtcNow); Assert.Equal(1, provider.Requests);
        Assert.Equal(2, db.GuestPushJobs.Count(x => x.Status == "Cancelled"));
    }

    private static (string Key, string Auth) ClientKeys()
    {
        using var ec = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var p = ec.ExportParameters(false);
        return (WebEncoders.Base64UrlEncode([4, ..p.Q.X!, ..p.Q.Y!]), WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(16)));
    }

    private sealed class Provider : HttpMessageHandler, IHttpClientFactory
    {
        public int Requests; public bool Encrypted;
        public HttpClient CreateClient(string name) => new(this, false);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests++; var bytes = await request.Content!.ReadAsByteArrayAsync(ct);
            Encrypted = request.Content.Headers.ContentEncoding.Contains("aes128gcm") && bytes.Length > 100
                && request.Headers.Authorization?.Scheme.Equals("vapid", StringComparison.OrdinalIgnoreCase) == true;
            return new HttpResponseMessage(HttpStatusCode.Created);
        }
    }
}
