import api from '../api/client';
import type { NavigationPlace, NavigationRoute, NavigationStep } from '../types/navigation';
import { validCoordinate } from '../utils/routeProgress';

const instruction = (s: any): string => {
  const m = s.maneuver ?? {}, suffix = s.name ? ` en ${s.name}` : '';
  if (m.type === 'depart') return 'Inicia tu recorrido';
  if (m.type === 'arrive') return 'Llegada a tu destino';
  if (m.type === 'roundabout' || m.type === 'rotary') return `En la rotonda, toma la salida${Number.isInteger(m.exit) ? ` ${m.exit}` : ''}`;
  if (m.modifier === 'right') return `Gira a la derecha${suffix}`;
  if (m.modifier === 'left') return `Gira a la izquierda${suffix}`;
  if (m.modifier === 'slight right') return `Mantente a la derecha${suffix}`;
  if (m.modifier === 'slight left') return `Mantente a la izquierda${suffix}`;
  if (m.modifier?.includes('uturn')) return 'Realiza un retorno donde esté permitido';
  return s.name ? `Continúa por ${s.name}` : 'Continúa recto';
};
export const parseNavigationRoutes = (data: any): NavigationRoute[] => {
  if (data?.code && data.code !== 'Ok') throw new Error('El proveedor no encontró una ruta vial válida.');
  const routes: NavigationRoute[] = (Array.isArray(data?.routes) ? data.routes.slice(0, 5) : []).flatMap((r: any, id: number) => {
    if (!Number.isFinite(r.distance) || !Number.isFinite(r.duration) || r.distance < 0 || r.duration < 0
      || !Array.isArray(r.geometry?.coordinates) || r.geometry.coordinates.length < 2 || r.geometry.coordinates.length > 30_000) return [];
    const coords = r.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    if (coords.some((c: number[]) => !validCoordinate({ lat: c[0], lng: c[1] }))) return [];
    let progressMeters = 0;
    const steps: NavigationStep[] = [];
    for (const leg of r.legs ?? []) for (const s of leg.steps ?? []) {
      const m = s.maneuver ?? {};
      if (Array.isArray(m.location) && validCoordinate({ lat: m.location[1], lng: m.location[0] })) {
        steps.push({ name: String(s.name ?? ''), distance: Math.max(0, Number(s.distance) || 0), type: m.type ?? 'turn',
          modifier: m.modifier, instruction: instruction(s), location: [m.location[1], m.location[0]], progressMeters });
      }
      progressMeters += Math.max(0, Number(s.distance) || 0);
    }
    return [{ id, distKm: r.distance / 1000, durationMin: Math.max(1, Math.ceil(r.duration / 60)), coords, steps }];
  });
  if (!routes.length) throw new Error('No se encontró una ruta por carretera. Reintenta cuando haya conexión.');
  return routes;
};
export const fetchNavigationRoutes = async (destination: NavigationPlace, origin: { lat: number; lng: number }, signal: AbortSignal) => {
  if (!validCoordinate(origin) || !validCoordinate(destination)) throw new Error('Espera una ubicación GPS válida para calcular la ruta.');
  const res = await api.get('/mapas/ruta', { params: { puntos: `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`, alternativas: true }, timeout: 16_000, signal });
  return parseNavigationRoutes(res.data);
};
