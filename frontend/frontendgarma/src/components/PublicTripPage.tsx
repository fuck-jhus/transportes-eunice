import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as L from 'leaflet';
import { isAxiosError } from 'axios';
import 'leaflet/dist/leaflet.css';
import { BusFront, Clock3, MapPin, MessageCircle, Moon, Navigation, RefreshCw, Send, ShieldCheck, Sun } from 'lucide-react';
import api from '../services/api';
import { GuestPushControls } from './GuestPushControls';

interface PositionPoint {
  latitud: number;
  longitud: number;
  fechaHora: string;
}

interface PublicTrip {
  estadoViaje: string;
  nombreRuta: string;
  origen: string;
  destino: string;
  unidad: string;
  conductor: string;
  fechaInicio: string;
  fechaFin?: string;
  chatHabilitado: boolean;
  modoPrivacidad: boolean;
  ubicacionDisponible: boolean;
  ubicacionDesactualizada: boolean;
  posicionActual?: PositionPoint;
  destinoLatitud?: number;
  destinoLongitud?: number;
  destinoNombre?: string;
  recorrido: PositionPoint[];
}

interface PublicRoute {
  coordenadas: [number, number][];
  distanciaKm: number;
  duracionMinutos: number;
}

interface GuestSession { idConversacion: string; alias: string; bloqueada: boolean }
interface GuestMessage {
  idMensaje: string;
  idConversacion: string;
  tipoEmisor: 'Pasajero' | 'Piloto' | 'Operador';
  nombreEmisor: string;
  contenido: string;
  idCliente?: string;
  fechaHora: string;
  fechaLectura?: string;
}

const DEFAULT_CENTER: L.LatLngTuple = [14.8347, -91.5180];

export const PublicTripPage = ({ token }: { token: string }) => {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const pendingMessages = useRef(new Map<string, string>());
  const [unseenMessages, setUnseenMessages] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [syncError, setSyncError] = useState(false);
  const [trip, setTrip] = useState<PublicTrip | null>(null);
  const [route, setRoute] = useState<PublicRoute | null>(null);
  const [session, setSession] = useState<GuestSession | null>(null);
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [chatError, setChatError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDark, setIsDark] = useState(() => localStorage.getItem('eunice-public-theme') !== 'light');

  const fetchTrip = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await api.get<PublicTrip>(`/public/viajes/${encodeURIComponent(token)}`);
      setTrip(response.data);
      setSyncError(false);
      setError('');
    } catch (requestError: unknown) {
      setSyncError(true);
      const status = isAxiosError(requestError) ? requestError.response?.status : undefined;
      if (status === 404 || status === 410) {
        setError('Este enlace no existe, venció o fue revocado por el centro de control.');
      } else if (!silent) {
        setError('No pudimos conectar con el seguimiento. Revisa tu conexión e inténtalo de nuevo.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  const startSession = useCallback(async () => {
    try {
      setStartingSession(true);
      setChatError('');
      const response = await api.post<GuestSession>(`/public/viajes/${encodeURIComponent(token)}/sesion`, {});
      setSession(response.data);
    } catch {
      setSession(null);
      setChatError('No se pudo abrir la conversación. Intenta nuevamente.');
    } finally {
      setStartingSession(false);
    }
  }, [token]);

  const fetchMessages = useCallback(async (before?: string) => {
    if (!session) return;
    try {
      const response = await api.get<GuestMessage[]>(`/public/viajes/${encodeURIComponent(token)}/mensajes`, { params: { antes: before } });
      setMessages(current => {
        const incoming = Array.isArray(response.data) ? response.data : [];
        const merged = new Map([...current, ...incoming].map(item => [item.idMensaje, item]));
        return [...merged.values()].sort((a, b) => Date.parse(a.fechaHora) - Date.parse(b.fechaHora));
      });
    } catch {
      // La siguiente sincronización reintenta sin interrumpir el mapa.
    }
  }, [session, token]);

  const fetchRoute = useCallback(async () => {
    try {
      const response = await api.get<PublicRoute>(`/public/viajes/${encodeURIComponent(token)}/ruta`);
      setRoute(response.data);
    } catch {
      setRoute(null);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 3_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void fetchTrip(), 0);
    const timer = window.setInterval(() => void fetchTrip(true), 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [fetchTrip]);

  useEffect(() => {
    if (!session) return;
    const initial = window.setTimeout(() => void fetchMessages(), 0);
    const timer = window.setInterval(() => void fetchMessages(), 4_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [fetchMessages, session]);

  useEffect(() => {
    if (!trip?.ubicacionDisponible || !trip.destinoLatitud || !trip.destinoLongitud) return;
    const initial = window.setTimeout(() => void fetchRoute(), 0);
    const timer = window.setInterval(() => void fetchRoute(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [fetchRoute, trip?.destinoLatitud, trip?.destinoLongitud, trip?.ubicacionDisponible]);

  useEffect(() => {
    localStorage.setItem('eunice-public-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;
    const map = L.map(mapElementRef.current, {
      center: DEFAULT_CENTER,
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
      touchZoom: true,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
    });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const timers = [100, 350, 800].map((delay) => window.setTimeout(() => map.invalidateSize(), delay));
    return () => {
      timers.forEach(window.clearTimeout);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers || !trip) return;
    layers.clearLayers();

    const bounds: L.LatLngTuple[] = [];
    const history = (trip.recorrido || []).map((point) => [Number(point.latitud), Number(point.longitud)] as L.LatLngTuple);
    if (history.length > 1) {
      L.polyline(history, { color: '#d85f28', weight: 5, opacity: 0.8, lineCap: 'round' }).addTo(layers);
      bounds.push(...history);
    }
    if (route?.coordenadas?.length) {
      const remaining = route.coordenadas.map(([lat, lng]) => [Number(lat), Number(lng)] as L.LatLngTuple);
      L.polyline(remaining, { color: '#267485', weight: 5, opacity: 0.82, dashArray: '9 10', lineCap: 'round' }).addTo(layers);
      bounds.push(...remaining);
    }
    if (trip.posicionActual) {
      const current: L.LatLngTuple = [Number(trip.posicionActual.latitud), Number(trip.posicionActual.longitud)];
      const icon = L.divIcon({
        className: 'public-bus-marker-shell',
        html: '<div class="public-bus-marker"><span></span></div>',
        iconSize: [46, 46],
        iconAnchor: [23, 23],
      });
      L.marker(current, { icon, zIndexOffset: 1000 }).addTo(layers).bindTooltip(`Unidad ${trip.unidad}`, { direction: 'top', offset: [0, -20] });
      bounds.push(current);
    }
    if (trip.destinoLatitud && trip.destinoLongitud) {
      const destination: L.LatLngTuple = [Number(trip.destinoLatitud), Number(trip.destinoLongitud)];
      L.circleMarker(destination, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#267485', fillOpacity: 1 }).addTo(layers)
        .bindTooltip(trip.destinoNombre || trip.destino, { direction: 'top' });
      bounds.push(destination);
    }
    if (!fittedRef.current && bounds.length) {
      fittedRef.current = true;
      map.fitBounds(L.latLngBounds(bounds), { padding: [44, 44], maxZoom: 16 });
    }
  }, [route, trip]);

  const newestMessageId = messages.at(-1)?.idMensaje;
  useEffect(() => {
    if (nearBottomRef.current) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    else setUnseenMessages(true);
  }, [newestMessageId]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if (!content || sending || !session || session.bloqueada) return;
    const operationKey = `eunice-public-message:${session.idConversacion}:${content}`;
    let clientId = pendingMessages.current.get(operationKey);
    try { clientId ??= sessionStorage.getItem(operationKey) ?? undefined; } catch { /* In-memory identity still protects retries. */ }
    clientId ??= crypto.randomUUID();
    pendingMessages.current.set(operationKey, clientId);
    try { sessionStorage.setItem(operationKey, clientId); } catch { /* Restricted browser storage. */ }
    setSending(true);
    setChatError('');
    try {
      const response = await api.post<GuestMessage>(`/public/viajes/${encodeURIComponent(token)}/mensajes`, {
        contenido: content,
        idCliente: clientId,
      });
      setMessages((current) => current.some((item) => item.idMensaje === response.data.idMensaje)
        ? current
        : [...current, response.data]);
      pendingMessages.current.delete(operationKey);
      try { sessionStorage.removeItem(operationKey); } catch { /* Storage is optional. */ }
      setMessage(current => current.trim() === content ? '' : current);
    } catch {
      setChatError('El mensaje no se pudo enviar. Conservamos el texto para que lo intentes de nuevo.');
    } finally {
      setSending(false);
    }
  };

  const lastUpdate = trip?.posicionActual?.fechaHora
    ? new Date(trip.posicionActual.fechaHora).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })
    : 'Sin señal';
  const observedAt = trip?.posicionActual?.fechaHora ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(trip.posicionActual.fechaHora) ? trip.posicionActual.fechaHora : `${trip.posicionActual.fechaHora}Z`) : 0;
  const stale = !observedAt || clock - observedAt > 30_000 || clock < observedAt - 5_000;
  const statusLabel = trip?.estadoViaje !== 'En Curso'
    ? 'Viaje finalizado'
    : trip?.modoPrivacidad
    ? 'Ubicación pausada'
    : trip?.ubicacionDesactualizada || stale || syncError
      ? 'Señal intermitente'
      : trip?.ubicacionDisponible
        ? 'Ubicación en vivo'
        : 'Esperando señal';
  const statusClass = trip?.ubicacionDisponible && !trip?.ubicacionDesactualizada && !stale && !syncError && !trip?.modoPrivacidad ? 'is-live' : 'is-stale';

  if (loading) {
    return <main className={`public-trip-page ${isDark ? 'dark-theme' : ''}`}><div className="public-trip-loading"><BusFront size={30} /><span>Preparando el seguimiento del viaje</span></div></main>;
  }

  if (error || !trip) {
    return <main className={`public-trip-page ${isDark ? 'dark-theme' : ''}`}><section className="public-trip-error"><ShieldCheck size={34} /><h1>Enlace no disponible</h1><p>{error}</p></section></main>;
  }

  return (
    <main className={`public-trip-page ${isDark ? 'dark-theme' : ''}`}>
      <header className="public-trip-header">
        <div className="public-trip-brand"><span><BusFront size={22} /></span><div><strong>Eunice</strong><small>Seguimiento de viaje</small></div></div>
        <div className={`public-trip-status ${statusClass}`}><span />{statusLabel}</div>
        <button className="public-icon-button" type="button" onClick={() => setIsDark((value) => !value)} aria-label="Cambiar tema">
          {isDark ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </header>

      <section className="public-trip-summary">
        <div className="public-trip-route-copy"><span className="public-eyebrow">VIAJE COMPARTIDO</span><h1>{trip.nombreRuta}</h1><p>{trip.origen} <Navigation size={14} /> {trip.destino}</p></div>
        <div className="public-trip-metrics">
          <div><BusFront size={17} /><span><small>Unidad</small><strong>{trip.unidad}</strong></span></div>
          <div><Clock3 size={17} /><span><small>Última señal</small><strong>{lastUpdate}</strong></span></div>
          <div><MapPin size={17} /><span><small>Restante</small><strong>{route ? `${route.distanciaKm} km` : trip.destinoLatitud && trip.destinoLongitud ? 'Calculando' : 'Por definir'}</strong></span></div>
        </div>
      </section>

      <div className="public-trip-workspace">
        <section className="public-map-card">
          <div ref={mapElementRef} className={`public-trip-map ${isDark ? 'map-dark' : ''}`} />
          {(!trip.ubicacionDisponible || trip.modoPrivacidad) && (
            <div className="public-map-notice"><RefreshCw size={18} /><span>{trip.modoPrivacidad ? 'El conductor pausó temporalmente la ubicación.' : 'Esperando la primera señal GPS del viaje.'}</span></div>
          )}
          {route && <div className="public-route-eta"><Navigation size={16} /><div><small>Tiempo aproximado</small><strong>{route.duracionMinutos} min</strong></div></div>}
        </section>

        <aside className="public-chat-card">
          <div className="public-chat-header"><span><MessageCircle size={20} /></span><div><h2>Habla con tu conductor</h2><p>{session ? `Conectado como ${session.alias}` : 'Canal privado disponible'}</p></div></div>
          <div className="public-chat-safety"><ShieldCheck size={15} /><span>La conversación es privada y también puede ser atendida por el centro de control.</span></div>
          {chatError && <div className="public-chat-error">{chatError}</div>}
          {session && trip.chatHabilitado && !session.bloqueada && <GuestPushControls key={`${token}:${session.idConversacion}`} token={token} />}
          <div className="public-chat-messages" aria-live="polite" onScroll={event => {
            const node = event.currentTarget;
            nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            if (nearBottomRef.current) setUnseenMessages(false);
          }}>
            {messages.length > 0 && <button type="button" onClick={() => { nearBottomRef.current = false; void fetchMessages(messages[0]?.idMensaje); }}>Cargar mensajes anteriores</button>}
            {messages.length === 0 ? (
              <div className="public-chat-empty"><MessageCircle size={25} /><strong>¿Necesitas ayuda con el viaje?</strong><span>Envía un mensaje. El conductor responderá cuando sea seguro hacerlo.</span></div>
            ) : messages.map((item) => {
              const mine = item.tipoEmisor === 'Pasajero';
              return <div key={item.idMensaje} className={`public-message-row ${mine ? 'mine' : ''}`}><div className="public-message"><small>{mine ? 'Tú' : item.nombreEmisor}</small><p>{item.contenido}</p><time>{new Date(item.fechaHora).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}</time></div></div>;
            })}
            <div ref={messagesEndRef} />
          </div>
          {unseenMessages && <button type="button" onClick={() => { nearBottomRef.current = true; setUnseenMessages(false); messagesEndRef.current?.scrollIntoView({ block: 'nearest' }); }}>Ver mensajes nuevos</button>}
          {messages.length > 0 && <button type="button" onClick={() => void api.post(`/public/viajes/${encodeURIComponent(token)}/leido`, { idsMensaje: messages.slice(-200).map(x => x.idMensaje) }).catch(() => setChatError('No se pudo confirmar la lectura.'))}>Confirmar lectura de los mensajes mostrados</button>}
          {trip.chatHabilitado ? (
            session ? (
              <form className="public-chat-composer" onSubmit={sendMessage}>
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={2} placeholder="Escribe un mensaje breve" disabled={session.bloqueada} />
                <button type="submit" disabled={!message.trim() || sending || session.bloqueada} aria-label="Enviar mensaje"><Send size={18} /></button>
              </form>
            ) : (
              <div className="public-chat-start"><button type="button" onClick={() => void startSession()} disabled={startingSession}><MessageCircle size={17} />{startingSession ? 'Abriendo conversación...' : 'Iniciar conversación'}</button></div>
            )
          ) : <div className="public-chat-closed">La conversación se cerró al finalizar el viaje.</div>}
        </aside>
      </div>
    </main>
  );
};
