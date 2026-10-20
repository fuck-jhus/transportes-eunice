using System.Security.Cryptography;
using System.Text;

namespace webapi.Core;

public static class PublicTripToken
{
    public const string GuestCookieName = "EuniceGuestTrip";

    public static string Create(int byteLength = 24)
    {
        var bytes = RandomNumberGenerator.GetBytes(byteLength);
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    public static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public static bool IsValid(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Length is >= 24 and <= 96
        && value.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

    public static string NormalizeAlias(string? alias, Guid conversationId)
    {
        var normalized = NormalizePlainText(alias, 60);
        return string.IsNullOrWhiteSpace(normalized)
            ? $"Pasajero {conversationId.ToString("N")[..4].ToUpperInvariant()}"
            : normalized;
    }

    public static string NormalizeMessage(string? message) => NormalizePlainText(message, 500);

    private static string NormalizePlainText(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        var builder = new StringBuilder(Math.Min(value.Length, maxLength));
        foreach (var character in value.Trim())
        {
            if (builder.Length >= maxLength) break;
            if (character is '\r' or '\n' or '\t' || !char.IsControl(character))
            {
                builder.Append(character);
            }
        }

        return builder.ToString().Trim();
    }
}
