using AccesoDatos.Context;
using AccesoDatos.Models;
using Microsoft.EntityFrameworkCore;
using webapi.Services;

namespace webapi.Core;

// El centro de control atiende primero a los pasajeros. Una conversación pasa al conductor
// solo si un operador la deriva o si nadie del equipo responde en EscalateAfter.
public static class PassengerEscalation
{
    public static readonly TimeSpan EscalateAfter = TimeSpan.FromMinutes(3);

    public static async Task DeriveAsync(PrevencionAccidentesBusesContext db, ConversacionPasajero conversation,
        DateTime now, string reason, int? actorId = null, CancellationToken ct = default)
    {
        if (conversation.FechaDerivadaPiloto != null) return;
        conversation.FechaDerivadaPiloto = now;
        var trip = conversation.IdAccesoNavigation.IdViajeNavigation;
        await PushOutbox.AddAsync(db, $"passenger-escalated:{conversation.IdConversacion}", "Pasajero en espera",
            $"{conversation.AliasPasajero}: {reason}", new Dictionary<string, string?>
            {
                ["type"] = "passenger_message", ["tab"] = "chat", ["tripId"] = trip.IdViaje.ToString(),
                ["conversationId"] = conversation.IdConversacion.ToString()
            }, [trip.IdUsuario], null, actorId, ct);
    }

    public static async Task<int> ProcessAsync(PrevencionAccidentesBusesContext db, DateTime now, CancellationToken ct = default)
    {
        var limit = now - EscalateAfter;
        var due = await db.ConversacionesPasajeros
            .Include(x => x.IdAccesoNavigation).ThenInclude(x => x.IdViajeNavigation)
            .Where(x => x.FechaDerivadaPiloto == null && !x.Bloqueada
                && x.IdAccesoNavigation.ChatHabilitado && x.IdAccesoNavigation.FechaRevocacion == null
                && x.IdAccesoNavigation.FechaExpiracion > now
                && x.IdAccesoNavigation.IdViajeNavigation.EstadoViaje == EstadosViaje.EnCurso
                && x.Mensajes.OrderByDescending(m => m.FechaHora).Select(m => m.TipoEmisor).FirstOrDefault() == "Pasajero"
                && x.Mensajes.Where(m => m.TipoEmisor == "Pasajero").Max(m => (DateTime?)m.FechaHora) <= limit)
            .Take(50)
            .ToListAsync(ct);
        foreach (var conversation in due)
            await DeriveAsync(db, conversation, now, "nadie del centro de control respondió todavía.", ct: ct);
        if (due.Count > 0) await db.SaveChangesAsync(ct);
        return due.Count;
    }
}
