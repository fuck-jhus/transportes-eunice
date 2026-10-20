import type * as L from 'leaflet';

export interface BusMarkerData {
  placaAutobus: string;
  nombrePiloto: string;
  nombreRuta?: string;
  velocidadKmh: number;
  aceleracionX?: number;
  aceleracionY?: number;
  aceleracionZ?: number;
  giroscopioX?: number;
  giroscopioY?: number;
  giroscopioZ?: number;
  latitud: number;
  longitud: number;
  destinoLat?: number | null;
  destinoLng?: number | null;
  destinoNombre?: string | null;
  isTripActive?: boolean;
  isPrivacyMode?: boolean;
  locationStatus?: 'tracking' | 'privacy' | 'unavailable';
  fechaHoraDispositivo?: string;
  origenNombre?: string;
}

export interface SavedLocation {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm?: number;
}

export interface RouteOption {
  id: number;
  distKm: number;
  durationMin: number;
  coords: L.LatLngTuple[];
}

export interface RouteStep {
  name?: string;
  distance?: number;
  geometry?: { coordinates?: number[][] };
}

export interface RoutingResult {
  distance: number;
  duration: number;
  geometry: { coordinates: number[][] };
  legs?: Array<{ steps?: RouteStep[] }>;
}

export interface GeocodingResult {
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
}

export type BusMarker = L.Marker & {
  __routeToggleHandler?: (event: L.PopupEvent) => void;
};

export interface GoogleMapWebProps {
  buses?: BusMarkerData[];
  selectedBusPlaca?: string | null;
  onSelectBus?: (placa: string) => void;
  userRole?: string;
  activeLiveRoutePlaca?: string | null;
  onToggleLiveRoute?: (placa: string) => void;
  privacyBusesList?: BusMarkerData[];
  theme?: 'light' | 'dark';
  onNotify?: (message: string, tone?: 'success' | 'error' | 'warning' | 'info') => void;
  pilotTracking?: {
    phase: 'inactive' | 'locating' | 'tracking' | 'weak' | 'offline' | 'paused' | 'blocked' | 'error';
    statusText: string;
    location: { lat: number; lng: number } | null;
    accuracy: number | null;
  };
  onPilotNavigationChange?: (navigation: { lat: number; lng: number; name: string } | null) => void;
  activeTripId?: number | null;
  activeTripRouteName?: string | null;
  onSavePilotRoute?: (route: {
    nombreRuta: string;
    origen: string;
    destino: string;
    origenLatitud?: number;
    origenLongitud?: number;
    destinoLatitud: number;
    destinoLongitud: number;
  }) => Promise<void>;
}

// Coordenadas por defecto (Quetzaltenango, Guatemala)
export const DEFAULT_CENTER = { lat: 14.8347, lng: -91.5181 };

export const hasValidCoordinates = (lat: unknown, lng: unknown): boolean => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
};

export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character] ?? character));

// Nodos viales clave de Guatemala para corredores y rutas urbanas / interurbanas
export const GUATEMALA_HIGHWAY_HUBS = [
  { name: 'Centro Histórico / Parque Central (Xela)', lat: 14.8348, lng: -91.5181 },
  { name: 'Terminal Minerva / Zona 3 (Xela)', lat: 14.8465, lng: -91.5348 },
  { name: 'Salcajá / Cuatro Caminos', lat: 14.8778, lng: -91.4589 },
  { name: 'San Marcos / San Pedro Sac.', lat: 14.9641, lng: -91.7958 },
  { name: 'Totonicapán', lat: 14.9117, lng: -91.3611 },
  { name: 'Coatepeque', lat: 14.7042, lng: -91.8631 },
  { name: 'Mazatenango / Retalhuleu', lat: 14.5342, lng: -91.5303 },
  { name: 'Huehuetenango (CA-1 Occidente)', lat: 15.3197, lng: -91.4711 },
  { name: 'Ciudad de Guatemala (CA-9 Norte / CA-1)', lat: 14.6349, lng: -90.5069 },
  { name: 'Antigua Guatemala', lat: 14.5586, lng: -90.7339 },
  { name: 'Costa Sur / Escuintla (CA-2 Occidente / CA-9 Sur)', lat: 14.3009, lng: -90.7882 },
  { name: 'Cobán / Verapaces (CA-14)', lat: 15.4708, lng: -90.3708 },
  { name: 'El Rancho / Atlántico (CA-9)', lat: 14.9122, lng: -90.0156 },
];

// Función para calcular distancia en KM (Fórmula Haversine)
export const getDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
};

// Formato de duración en Horas y Minutos estilo Google Maps
export const formatDuration = (totalMinutes: number): string => {
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
};

const isAlleyName = (name: string | undefined): boolean => {
  if (!name) return false;
  const letterAlley = /\b(Avenida|Calle|Diagonal)\s+[A-E]\b/i.test(name);
  const passageAlley = /\b(Callej[oó]n|Pasaje|Servidumbre|Sendero|Peatonal)\b/i.test(name);
  return letterAlley || passageAlley;
};

// Evita sugerir callejones breves como parte principal de una ruta vehicular.
export const toLatLngTuple = (coordinate: number[]): L.LatLngTuple => [coordinate[1], coordinate[0]];

export const sanitizeRouteCoordinates = (steps: RouteStep[], rawCoords: L.LatLngTuple[]): L.LatLngTuple[] => {
  if (!steps || steps.length === 0) return rawCoords;

  const finalCoords: L.LatLngTuple[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (isAlleyName(step.name) && (step.distance ?? 0) < 250 && i > 0 && i < steps.length - 1) {
      const previous = steps[i - 1]?.geometry?.coordinates;
      const next = steps[i + 1]?.geometry?.coordinates;
      if (previous?.length && next?.length) {
        const previousLast = previous[previous.length - 1];
        const previousFirst = previous[0];
        const nextFirst = next[0];
        const previousIsEastWest =
          Math.abs(previousLast[0] - previousFirst[0]) > Math.abs(previousLast[1] - previousFirst[1]);
        const corner = previousIsEastWest
          ? [nextFirst[0], previousLast[1]]
          : [previousLast[0], nextFirst[1]];
        finalCoords.push([corner[1], corner[0]]);
        continue;
      }
    }

    step.geometry?.coordinates?.forEach((coordinate) => {
      const point: L.LatLngTuple = [coordinate[1], coordinate[0]];
      const last = finalCoords[finalCoords.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) finalCoords.push(point);
    });
  }

  return finalCoords.length > 2 ? finalCoords : rawCoords;
};
