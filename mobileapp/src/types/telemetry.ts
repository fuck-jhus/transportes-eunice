export interface UserSession {
  idUsuario: number;
  nombreCompleto: string;
  usuarioLogin: string;
  tipoRol: string;
}

export interface ViajeActivo {
  revisionDestino?: number;
  version?: string;
  idViaje: number;
  idUsuario: number;
  nombrePiloto: string;
  idAutobus: number;
  placaAutobus: string;
  idRuta?: number;
  nombreRuta?: string;
  origenRuta?: string;
  destinoRuta?: string;
  destinoLatitud?: number | null;
  destinoLongitud?: number | null;
  destinoNombre?: string | null;
  fechaInicio: string;
  estadoViaje: string;
}

export interface CrearTelemetriaDto {
  idLectura?: string;
  idFuente?: string;
  sensoresCalibrados?: boolean;
  precisionMetros?: number;
  idViaje?: number;
  latitud: number;
  longitud: number;
  velocidadKmh: number;
  aceleracionX?: number;
  aceleracionY?: number;
  aceleracionZ?: number;
  giroscopioX?: number;
  giroscopioY?: number;
  giroscopioZ?: number;
  heading?: number;
  fechaHoraDispositivo: string;
  destinoLat?: number;
  destinoLng?: number;
  destinoNombre?: string;
}

export type TrackingPhase =
  | 'inactive'
  | 'locating'
  | 'tracking'
  | 'weak'
  | 'stale'
  | 'offline'
  | 'paused'
  | 'blocked'
  | 'error';

export interface MobileTrackingSnapshot {
  phase: TrackingPhase;
  statusText: string;
  location: { lat: number; lng: number } | null;
  displayLocation?: { lat: number; lng: number } | null;
  locationTimestamp?: number | null;
  locationFresh?: boolean;
  backgroundStatus?: 'inactive' | 'starting' | 'active' | 'denied' | 'error';
  queueError?: string | null;
  speedKmh: number;
  heading: number | null;
  accuracy: number | null;
  queuedReadings: number;
  lastSentAt: number | null;
  assignedTrip: ViajeActivo | null;
  assignmentConfirmed?: boolean;
  sourceConflict?: boolean;
  takeTrackingControl?: () => Promise<void>;
  retry: () => void;
  streamTelemetryNow: (
    overrideCoords?: { lat: number; lng: number },
    overrideDestination?: { lat: number; lng: number; name?: string } | null,
    overrideTripActive?: boolean,
  ) => void;
}

export interface SensorReading {
  speed: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  lat: number;
  lng: number;
}
