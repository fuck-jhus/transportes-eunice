import { bearingBetween, distanceMeters, validHeading } from './navigationTelemetry';

export interface FleetBus {
  placaAutobus: string;
  nombrePiloto?: string;
  nombreRuta?: string;
  velocidadKmh: number;
  latitud: number;
  longitud: number;
  heading?: number | null;
  destinoLat?: number;
  destinoLng?: number;
  destinoNombre?: string;
  isTripActive?: boolean;
  timestamp?: number;
  receivedAt?: number;
}

export const mergeFleetReading = (buses: FleetBus[], data: any, now = Date.now()): FleetBus[] => {
  if (typeof data?.placaAutobus !== 'string' || !data.placaAutobus.trim()) return buses;
  const key = data.placaAutobus.toLowerCase();
  const previous = buses.find(bus => bus.placaAutobus.toLowerCase() === key);
  if (data.isOffline || data.isPrivacyMode) return buses.filter(bus => bus.placaAutobus.toLowerCase() !== key);
  const lat = Number(data.latitud);
  const lng = Number(data.longitud);
  if (data.latitud == null || data.longitud == null || !Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return buses;
  const parsedTimestamp = Date.parse(data.fechaHoraDispositivo);
  const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : now;
  if (previous?.timestamp && timestamp < previous.timestamp) return buses;
  // Old offline batches belong in history, not on the live map.
  if (now - timestamp > 120_000) return buses;
  const position = { lat, lng };
  const speed = Math.max(0, Number(data.velocidadKmh) || 0);
  let heading = validHeading(data.heading);
  if (heading == null && speed >= 4 && previous
    && distanceMeters({ lat: previous.latitud, lng: previous.longitud }, position) >= 6) {
    heading = bearingBetween({ lat: previous.latitud, lng: previous.longitud }, position);
  }
  const updated: FleetBus = {
    placaAutobus: data.placaAutobus,
    nombrePiloto: data.nombrePiloto || previous?.nombrePiloto || 'Piloto',
    nombreRuta: data.nombreRuta || previous?.nombreRuta || 'Ruta por definir',
    velocidadKmh: speed,
    latitud: lat,
    longitud: lng,
    heading: heading ?? previous?.heading ?? null,
    destinoLat: data.destinoLat,
    destinoLng: data.destinoLng,
    destinoNombre: data.destinoNombre,
    isTripActive: data.isTripActive ?? true,
    timestamp,
    receivedAt: now,
  };
  return previous ? buses.map(bus => bus === previous ? updated : bus) : [...buses, updated];
};
