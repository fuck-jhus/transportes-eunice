using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace webapi.Core;

public static partial class ContentModeration
{
    private static readonly string[] DefaultBlockedTerms =
    [
        "puta", "puto", "mierda", "verga", "culero", "idiota",
        "nazi", "racista", "pornografia", "pornografico", "pornographic",
        "kill yourself", "suicidate"
    ];

    public static bool IsAllowed(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return false;
        var normalized = NormalizeForMatching(content);
        var configured = Environment.GetEnvironmentVariable("CHAT_BLOCKED_TERMS")
            ?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            ?? [];

        return !DefaultBlockedTerms.Concat(configured)
            .Select(NormalizeForMatching)
            .Where(term => term.Length > 1)
            .Any(term => Regex.IsMatch(normalized, $@"(^|\W){Regex.Escape(term)}($|\W)", RegexOptions.CultureInvariant));
    }

    private static string NormalizeForMatching(string value)
    {
        var decomposed = value.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            {
                builder.Append(character);
            }
        }

        return RepeatedSeparators().Replace(builder.ToString().Normalize(NormalizationForm.FormC), " ");
    }

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex RepeatedSeparators();
}
