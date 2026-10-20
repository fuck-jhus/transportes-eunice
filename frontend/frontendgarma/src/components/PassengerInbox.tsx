import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { BusFront, MessageCircle, RefreshCw, Send, UserRound, X } from 'lucide-react';
import { isAxiosError } from 'axios';
import api from '../services/api';
import { useAuth } from '../context/useAuth';

interface PassengerConversation {
  idConversacion: string;
  idViaje: number;
  aliasPasajero: string;
  nombreRuta: string;
  unidad: string;
  fechaUltimaActividad: string;
  bloqueada: boolean;
  noLeidos: number;
  ultimoMensaje?: string;
}

interface PassengerMessage {
  idUsuarioEmisor?: number | null;
  idMensaje: string;
  idConversacion: string;
  tipoEmisor: 'Pasajero' | 'Piloto' | 'Operador';
  nombreEmisor: string;
  contenido: string;
  fechaHora: string;
}

interface PassengerInboxProps {
  onClose: () => void;
  readOnly?: boolean;
}

const quickReplies = [
  'Estamos en ruta.',
  'Llegaremos en breve.',
  'Consulta recibida por el conductor.',
];

export function PassengerInbox({ onClose, readOnly = false }: PassengerInboxProps) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<PassengerConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, PassengerMessage[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const messages = selectedId ? threads[selectedId] ?? [] : [];
  const input = selectedId ? drafts[selectedId] ?? '' : '';
  const setInput = (value: string) => { if (selectedId) setDrafts(previous => ({ ...previous, [selectedId]: value })); };
  const currentId = useRef(selectedId);
  useLayoutEffect(() => { currentId.current = selectedId; }, [selectedId]);
  const requests = useRef(new Map<string, number>());
  const sendIds = useRef(new Map<string, { content: string; id: string }>());
  const nearBottom = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [error, setError] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await api.get<PassengerConversation[]>('/conversaciones-pasajeros');
      const list = Array.isArray(response.data) ? response.data : [];
      setConversations(list);
      setSelectedId((current) => current && list.some((item) => item.idConversacion === current)
        ? current
        : list[0]?.idConversacion ?? null);
      setError('');
    } catch {
      if (!silent) setError('No se pudieron cargar las conversaciones de pasajeros.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, silent = false, before?: string) => {
    const request = (requests.current.get(conversationId) ?? 0) + 1;
    requests.current.set(conversationId, request);
    try {
      const response = await api.get<PassengerMessage[]>(`/conversaciones-pasajeros/${conversationId}/mensajes`, { params: { antes: before } });
      if (requests.current.get(conversationId) === request) setThreads(previous => ({ ...previous,
        [conversationId]: [...new Map([...(previous[conversationId] ?? []), ...(Array.isArray(response.data) ? response.data : [])]
          .map(item => [item.idMensaje, item])).values()].sort((a, b) => Date.parse(a.fechaHora) - Date.parse(b.fechaHora)) }));
      if (!silent && currentId.current === conversationId) setError('');
    } catch {
      if (!silent && currentId.current === conversationId) setError('No se pudo abrir esta conversación.');
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadConversations(), 0);
    const timer = window.setInterval(() => void loadConversations(true), 8_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) return;
    nearBottom.current = true;
    const initial = window.setTimeout(() => void loadMessages(selectedId), 0);
    const timer = window.setInterval(() => void loadMessages(selectedId, true), 4_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadMessages, selectedId]);

  const latestMessageId = messages.at(-1)?.idMensaje;
  useEffect(() => {
    if (nearBottom.current) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'auto' });
    else queueMicrotask(() => setNewMessages(true));
  }, [selectedId, latestMessageId]);

  const send = async (content: string, quick = false) => {
    const clean = content.trim();
    if (readOnly || !selectedId || !clean || sending) return;
    const conversationId = selectedId;
    const pending = sendIds.current.get(conversationId);
    const id = pending?.content === clean ? pending.id : crypto.randomUUID();
    sendIds.current.set(conversationId, { content: clean, id });
    try {
      setSending(true);
      setError('');
      const response = await api.post<PassengerMessage>(`/conversaciones-pasajeros/${selectedId}/mensajes`, {
        idCliente: id,
        contenido: clean,
        respuestaRapida: quick,
      });
      requests.current.set(conversationId, (requests.current.get(conversationId) ?? 0) + 1);
      setThreads(previous => ({ ...previous, [conversationId]: (previous[conversationId] ?? []).some(item => item.idMensaje === response.data.idMensaje)
        ? previous[conversationId] : [...(previous[conversationId] ?? []), response.data] }));
      sendIds.current.delete(conversationId);
      if (!quick) setDrafts(previous => ({ ...previous, [conversationId]: previous[conversationId]?.trim() === clean ? '' : previous[conversationId] }));
      void loadConversations(true);
    } catch (requestError: unknown) {
      const apiMessage = isAxiosError<{ mensaje?: string }>(requestError)
        ? requestError.response?.data?.mensaje
        : undefined;
      if (currentId.current === conversationId) setError(apiMessage || 'No se confirmó el envío. El borrador se conserva para reintentar.');
    } finally {
      setSending(false);
    }
  };

  const acknowledgeLoaded = async () => {
    if (readOnly || !selectedId || acknowledging) return;
    const conversationId = selectedId;
    const ids = messages.map(message => message.idMensaje);
    setAcknowledging(true);
    try {
      for (let offset = 0; offset < ids.length; offset += 200)
        await api.post(`/conversaciones-pasajeros/${conversationId}/leido`, { idsMensaje: ids.slice(offset, offset + 200) });
      await loadConversations(true);
    } catch { if (currentId.current === conversationId) setError('No se confirmó toda la lectura. Puedes volver a intentarlo.'); }
    finally { setAcknowledging(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const selected = conversations.find((item) => item.idConversacion === selectedId);

  return (
    <div className="passenger-inbox-backdrop" role="dialog" aria-modal="true" aria-label="Conversaciones con pasajeros">
      <div className="passenger-inbox-shell">
        <header className="passenger-inbox-header">
          <div>
            <span className="passenger-inbox-eyebrow">ATENCIÓN AL PASAJERO</span>
            <h2>Consultas del viaje</h2>
          </div>
          <div className="passenger-inbox-header-actions">
            <button type="button" className="passenger-icon-button" onClick={() => void loadConversations()} aria-label="Actualizar"><RefreshCw size={17} /></button>
            <button type="button" className="passenger-icon-button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button>
          </div>
        </header>

        <div className="passenger-inbox-layout">
          <aside className="passenger-conversation-list">
            {loading ? <div className="passenger-inbox-empty">Cargando consultas...</div> : conversations.length === 0 ? (
              <div className="passenger-inbox-empty"><MessageCircle size={25} /><strong>Sin consultas activas</strong><span>Los mensajes enviados desde enlaces públicos aparecerán aquí.</span></div>
            ) : conversations.map((conversation) => (
              <button key={conversation.idConversacion} type="button" className={`passenger-conversation-card${conversation.idConversacion === selectedId ? ' is-active' : ''}`} onClick={() => setSelectedId(conversation.idConversacion)}>
                <div className="passenger-conversation-avatar"><UserRound size={16} /></div>
                <div className="passenger-conversation-copy">
                  <div><strong>{conversation.aliasPasajero}</strong>{conversation.noLeidos > 0 && <span className="passenger-unread">{conversation.noLeidos}</span>}</div>
                  <small><BusFront size={12} /> {conversation.unidad} · {conversation.nombreRuta}</small>
                  <p>{conversation.ultimoMensaje || 'Conversación iniciada'}</p>
                </div>
              </button>
            ))}
          </aside>

          <section className="passenger-thread">
            <div className="passenger-thread-title">
              <div><strong>{selected?.aliasPasajero || 'Selecciona una consulta'}</strong><span>{selected ? `${selected.unidad} · ${selected.nombreRuta}` : 'Mensajería privada por viaje'}</span></div>
              {selected?.bloqueada && <span className="passenger-blocked">Bloqueada</span>}
            </div>
            {selectedId && <div className="passenger-quick-replies">
              <button type="button" disabled={!messages.length} onClick={() => { nearBottom.current = false; void loadMessages(selectedId, false, messages[0]?.idMensaje); }}>Cargar mensajes anteriores</button>
              {!readOnly && <button type="button" disabled={acknowledging || !messages.length} onClick={() => void acknowledgeLoaded()}>{acknowledging ? 'Confirmando lectura…' : `Marcar ${messages.length} mensajes cargados como leídos · equipo`}</button>}
            </div>}
            {readOnly && <div className="passenger-inbox-readonly">Modo auditoría: la conversación está disponible únicamente para consulta.</div>}
            {error && <div className="passenger-inbox-error">{error}</div>}
            <div ref={threadRef} className="passenger-thread-messages" onScroll={event => {
              const element = event.currentTarget;
              nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
              if (nearBottom.current) setNewMessages(false);
            }}>
              {!selected ? <div className="passenger-inbox-empty">Selecciona una conversación para responder.</div> : messages.length === 0 ? <div className="passenger-inbox-empty">Aún no hay mensajes.</div> : messages.map((message) => {
                const passenger = message.tipoEmisor === 'Pasajero';
                return <div key={message.idMensaje} className={`passenger-message-row${message.idUsuarioEmisor === user?.idUsuario ? ' is-mine' : ''}`}><div className="passenger-message-bubble"><strong>{message.nombreEmisor} · {passenger ? 'Pasajero' : message.tipoEmisor === 'Piloto' ? 'Conductor' : 'Despacho'}</strong><p>{message.contenido}</p><time>{new Date(message.fechaHora).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}</time></div></div>;
              })}
            </div>
            <div className="passenger-quick-replies">
              {newMessages && <button type="button" onClick={() => {
                nearBottom.current = true; setNewMessages(false); threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'auto' });
              }}>Ir a mensajes recientes</button>}
              {quickReplies.map((reply) => <button key={reply} type="button" onClick={() => void send(reply, true)} disabled={readOnly || !selected || sending || selected.bloqueada}>{reply}</button>)}
            </div>
            <form className="passenger-composer" onSubmit={submit}>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={readOnly ? 'Conversación disponible en modo lectura' : 'Responder al pasajero'} maxLength={500} disabled={readOnly || !selected || sending || selected.bloqueada} />
              <button type="submit" disabled={readOnly || !selected || !input.trim() || sending || selected.bloqueada}><Send size={17} /><span>Enviar</span></button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
