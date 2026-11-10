import { useCallback, useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowDown, ArrowUp, MapPin, Save, Trash2, X } from 'lucide-react';
import { isAxiosError } from 'axios';
import api from '../services/api';

interface Stop { key: string; nombre: string; latitud: number; longitud: number }
interface RouteInfo { idRuta: number; nombreRuta: string; origen: string; destino: string; destinoLatitud?: number | null; destinoLongitud?: number | null }

const DEFAULT_CENTER: L.LatLngTuple = [14.8347, -91.5180];
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const stopIcon = (index: number) => L.divIcon({
  className: 'stop-pin-wrap',
  html: `<span class="stop-pin">${index + 1}</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

// Paradas de una ruta: un clic en el mapa agrega una parada; la lista define el orden del recorrido.
export function RouteStopsModal({ route, onClose, onSaved }: { route: RouteInfo; onClose: () => void; onSaved: (count: number) => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get<Array<{ nombre: string; latitud: number; longitud: number }>>(`/rutas/${route.idRuta}/paradas`)
      .then((response) => { if (active) setStops(response.data.map((x) => ({ ...x, key: newKey() }))); })
      .catch(() => { if (active) setError('No se pudieron cargar las paradas.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.idRuta]);

  const addStop = useCallback((lat: number, lng: number) => {
    setStops((current) => current.length >= 25 ? current : [...current, { key: newKey(), nombre: `Parada ${current.length + 1}`, latitud: Number(lat.toFixed(6)), longitud: Number(lng.toFixed(6)) }]);
  }, []);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const hasDestination = route.destinoLatitud != null && route.destinoLongitud != null;
    const map = L.map(mapElement.current, { zoomControl: true, zoomSnap: 0.25 })
      .setView(hasDestination ? [Number(route.destinoLatitud), Number(route.destinoLongitud)] : DEFAULT_CENTER, hasDestination ? 11 : 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => addStop(event.latlng.lat, event.latlng.lng));
    mapRef.current = map;
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => { window.clearTimeout(timer); map.remove(); mapRef.current = null; };
  }, [addStop, route.destinoLatitud, route.destinoLongitud]);

  const fittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (stops.length > 1) L.polyline(stops.map((x) => [x.latitud, x.longitud] as L.LatLngTuple), { color: '#1f5c46', weight: 3, dashArray: '6 8' }).addTo(layer);
    stops.forEach((stop, index) => {
      const marker = L.marker([stop.latitud, stop.longitud], { icon: stopIcon(index), draggable: true, title: stop.nombre }).addTo(layer);
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        setStops((current) => current.map((x) => x.key === stop.key ? { ...x, latitud: Number(position.lat.toFixed(6)), longitud: Number(position.lng.toFixed(6)) } : x));
      });
    });
    if (!fittedRef.current && stops.length > 0) {
      fittedRef.current = true;
      map.fitBounds(L.latLngBounds(stops.map((x) => [x.latitud, x.longitud] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 14 });
    }
  }, [stops]);

  const move = (index: number, delta: number) => setStops((current) => {
    const next = [...current];
    const target = index + delta;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const save = async () => {
    if (stops.some((x) => x.nombre.trim().length < 2)) { setError('Cada parada necesita un nombre de al menos 2 letras.'); return; }
    try {
      setSaving(true);
      setError('');
      await api.put(`/rutas/${route.idRuta}/paradas`, stops.map(({ nombre, latitud, longitud }) => ({ nombre: nombre.trim(), latitud, longitud })));
      onSaved(stops.length);
    } catch (requestError: unknown) {
      const apiMessage = isAxiosError<{ mensaje?: string }>(requestError) ? requestError.response?.data?.mensaje : undefined;
      setError(apiMessage || 'No se pudieron guardar las paradas.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="qr-backdrop" role="dialog" aria-modal="true" aria-labelledby="stops-title">
      <div className="stops-dialog">
        <header className="qr-dialog-head">
          <div>
            <span className="auth-kicker">Paradas de la ruta</span>
            <h2 id="stops-title">{route.nombreRuta}</h2>
            <p>Toca el mapa para agregar una parada y arrástrala para ajustarla. El orden de la lista es el orden del recorrido. Los pasajeros verán la próxima parada y cuánto falta.</p>
          </div>
          <button type="button" className="icon-pill" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>
        {error && <div className="auth-alert" role="alert">{error}</div>}
        <div className="stops-body">
          <div ref={mapElement} className="stops-map" />
          <div className="stops-side">
            <div className="stops-ends"><span className="route-stop is-start">{route.origen}</span></div>
            {loading ? <p className="feed-empty">Cargando paradas…</p> : stops.length === 0 ? (
              <p className="feed-empty"><MapPin size={18} aria-hidden="true" /> Aún no hay paradas. Toca el mapa para agregar la primera.</p>
            ) : (
              <ol className="stops-list">
                {stops.map((stop, index) => (
                  <li key={stop.key}>
                    <span className="stop-pin">{index + 1}</span>
                    <input value={stop.nombre} maxLength={100} aria-label={`Nombre de la parada ${index + 1}`}
                      onChange={(event) => setStops((current) => current.map((x) => x.key === stop.key ? { ...x, nombre: event.target.value } : x))} />
                    <button type="button" className="icon-pill" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Subir"><ArrowUp size={14} /></button>
                    <button type="button" className="icon-pill" onClick={() => move(index, 1)} disabled={index === stops.length - 1} aria-label="Bajar"><ArrowDown size={14} /></button>
                    <button type="button" className="icon-pill is-danger" onClick={() => setStops((current) => current.filter((x) => x.key !== stop.key))} aria-label="Quitar parada"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ol>
            )}
            <div className="stops-ends"><span className="route-stop is-end">{route.destino}</span></div>
          </div>
        </div>
        <footer className="qr-dialog-actions">
          <span className="stops-count">{stops.length} de 25 paradas</span>
          <button type="button" className="pill-button is-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="pill-button" onClick={() => void save()} disabled={saving || loading}><Save size={16} aria-hidden="true" /> {saving ? 'Guardando…' : 'Guardar paradas'}</button>
        </footer>
      </div>
    </div>
  );
}
