namespace webapi.Core;

// Respuestas fijas que un conductor puede enviar con la unidad en movimiento.
// El servidor decide si un texto es respuesta rápida; la bandera del cliente sola no basta.
public static class PassengerQuickReplies
{
    public static readonly IReadOnlyList<string> All =
    [
        "Estamos en ruta.",
        "Llegaremos en breve.",
        "Consulta recibida por el conductor.",
    ];

    public static bool IsQuickReply(string? content) =>
        content is not null && All.Contains(content.Trim(), StringComparer.Ordinal);
}
