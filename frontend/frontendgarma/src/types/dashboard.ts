export interface ManagedUser {
  version?: string;
  idUsuario: number;
  nombreCompleto: string;
  tipoRol: 'Piloto' | 'Administrador' | 'Supervisor' | 'SuperAdministrador';
  usuarioLogin: string;
  estado: 'Activo' | 'Inactivo';
}

export type DashboardTab = 'telemetry' | 'users' | 'buses' | 'routes' | 'trips' | 'alerts' | 'map' | 'activity' | 'chat';

export interface Autobus {
  version?: string;
  idViajeActivo?: number | null;
  idPilotoAsignado?: number | null;
  idRutaAsignada?: number | null;
  nombrePiloto?: string | null;
  disponibilidad?: string;
  idAutobus: number;
  placa: string;
  marcaModelo?: string;
  estado: 'Activo' | 'Inactivo' | 'En Taller';
}

export interface Ruta {
  idRuta: number;
  nombreRuta: string;
  origen: string;
  destino: string;
  origenLatitud?: number | null;
  origenLongitud?: number | null;
  destinoLatitud?: number | null;
  destinoLongitud?: number | null;
}

export interface Viaje {
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
  fechaFin?: string;
  estadoViaje: string;
}

export interface Alerta {
  idAlerta: number;
  idTelemetria: number;
  idViaje: number;
  tipoAlerta: string;
  valorRegistrado: number;
  limitePermitido?: number;
  fechaHora: string;
  placaAutobus: string;
  nombrePiloto: string;
  nombreRuta: string;
}

export interface LiveTelemetryData {
  idTelemetria?: number;
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
  destinoLat?: number | null;
  destinoLng?: number | null;
  destinoNombre?: string | null;
  isTripActive?: boolean;
  isPrivacyMode?: boolean;
  locationStatus?: 'tracking' | 'privacy' | 'unavailable';
  isOffline?: boolean;
  marcaModelo?: string | null;
  registeredStatus?: 'Activo' | 'Inactivo' | 'En Taller';
  idUsuario?: number;
  lastUpdated?: number;
  lastObservedAt?: number;
  fechaHoraDispositivo: string;
  placaAutobus: string;
  nombrePiloto: string;
  nombreRuta: string;
}

export interface ChatMessage {
  idMensaje: string;
  idEmisor: number;
  nombreEmisor: string;
  rolEmisor: string;
  idPilotoCanal: number;
  contenido: string;
  tipoContenido: string;
  fechaHora: string;
}
