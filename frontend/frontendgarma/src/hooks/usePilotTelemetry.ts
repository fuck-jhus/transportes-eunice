import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import api from '../services/api';
import type { Viaje } from '../types/dashboard';
import { getDistanceKm, hasValidCoordinates } from '../utils/mapSupport';

const SEND_INTERVAL_MS = 1_000;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_ACCEPTED_ACCURACY_METERS = 150;
const BATCH_SIZE = 100;
const STORAGE_PREFIX = 'eunice_telemetry_queue';
const PRIVACY_PREFIX = 'eunice_telemetry_paused';

export type PilotTrackingPhase =
  | 'inactive'
  | 'locating'
  | 'tracking'
  | 'weak'
  | 'offline'
  | 'paused'
  | 'blocked'
  | 'error';

export interface PilotNavigationState {
  lat: number;
  lng: number;
  name: string;
  tripId?: number;
  revision?: number;
}

export interface PilotTrackingSnapshot {
  phase: PilotTrackingPhase;
  statusText: string;
  location: { lat: number; lng: number } | null;
  accuracy: number | null;
  speedKmh: number;
  queuedReadings: number;
  lastSentAt: number | null;
  isPaused: boolean;
  isOnline: boolean;
  retry: () => void;
  togglePaused: () => Promise<void>;
  sourceConflict: boolean;
  takeTrackingControl: () => Promise<void>;
  exportPending: () => void;
}

interface TelemetryPayload {
  idViaje?: number;
  idLectura?: string;
  idFuente?: string;
  precisionMetros?: number;
  sensoresCalibrados?: boolean;
  heading?: number;
  latitud: number;
  longitud: number;
  velocidadKmh: number;
  fechaHoraDispositivo: string;
  destinoLat?: number;
  destinoLng?: number;
  destinoNombre?: string;
}

interface QueuedReading {
  rejection?: string;
  id: string;
  userId: number;
  tripId: number;
  createdAt: number;
  payload: TelemetryPayload;
}

interface UsePilotTelemetryOptions {
  enabled: boolean;
  userId?: number;
  activeTrip: Viaje | null;
  activeTripLoading: boolean;
  navigation: PilotNavigationState | null;
  onTripInvalidated: () => void;
  onNotify: (message: string, tone?: 'success' | 'error' | 'warning' | 'info') => void;
  onLiveTelemetry?: (payload: TelemetryPayload & { isTripActive: boolean }) => boolean;
}

const storageKey = (userId: number, tripId: number) => `${STORAGE_PREFIX}_${userId}_${tripId}`;
const privacyKey = (userId: number) => `${PRIVACY_PREFIX}_${userId}`;

const readQueue = (userId: number, tripId: number): QueuedReading[] => {
  try {
    const raw = localStorage.getItem(storageKey(userId, tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedReading[];
    if (!Array.isArray(parsed) || !parsed.every((item) => (
      item?.userId === userId
      && item?.tripId === tripId
      && hasValidCoordinates(item.payload?.latitud, item.payload?.longitud)
    ))) throw new Error('La cola requiere recuperación; no se ha eliminado.');
    return parsed;
  } catch {
    throw new Error('No se pudo leer el recorrido guardado. Se conserva para recuperación.');
  }
};

const writeQueue = (userId: number, tripId: number, readings: QueuedReading[]) => {
  try {
    const key = storageKey(userId, tripId);
    if (readings.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(readings));
    }
  } catch {
    throw new Error('No se pudo guardar el recorrido. Revisa el espacio y los permisos del navegador.');
  }
};

const queuedTrips = (userId: number) => {
  const prefix = `${STORAGE_PREFIX}_${userId}_`;
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(prefix)))
    .map(key => Number(key.slice(prefix.length))).filter(id => Number.isInteger(id) && id > 0);
};

const queueLock = <T,>(userId: number, action: () => Promise<T>): Promise<T> =>
  navigator.locks ? navigator.locks.request(`eunice-telemetry:${userId}`, action)
    : Promise.reject(new Error('Este navegador no puede proteger el archivo GPS entre pestañas. Actualízalo o usa la app móvil; los datos guardados se conservan.'));

const getPausedPreference = (userId?: number) => {
  if (!userId) return false;
  try {
    return localStorage.getItem(privacyKey(userId)) === 'true';
  } catch {
    return false;
  }
};

const getApiMessage = (error: unknown) => {
  if (!isAxiosError<{ mensaje?: string }>(error)) return '';
  return error.response?.data?.mensaje ?? '';
};

const isRetryableRequest = (error: unknown) => {
  if (!isAxiosError(error)) return false;
  return !error.response || error.response.status === 408 || error.response.status === 429 || error.response.status >= 500;
};

export const usePilotTelemetry = ({
  enabled,
  userId,
  activeTrip,
  activeTripLoading,
  navigation,
  onTripInvalidated,
  onNotify,
  onLiveTelemetry,
}: UsePilotTelemetryOptions): PilotTrackingSnapshot => {
  const [phase, setPhase] = useState<PilotTrackingPhase>('inactive');
  const [statusText, setStatusText] = useState('Esperando un viaje asignado');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [queuedReadings, setQueuedReadings] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isPaused, setIsPaused] = useState(() => getPausedPreference(userId));
  const [restartToken, setRestartToken] = useState(0);
  const [sourceConflict, setSourceConflict] = useState(false);
  const [queueIssue, setQueueIssue] = useState<string | null>(null);
  const sourceRef = useRef<string | null>(null);
  const currentAssignment = useRef(activeTrip);
  useEffect(() => { currentAssignment.current = activeTrip; }, [activeTrip]);
  const ownerRef = useRef(userId);
  const tripRef = useRef(activeTrip?.idViaje);
  useEffect(() => { ownerRef.current = userId; tripRef.current = activeTrip?.idViaje; }, [userId, activeTrip?.idViaje]);
  const acquireSource = useCallback(async (takeControl = false) => {
    if (!activeTrip) return;
    let id = localStorage.getItem('eunice-tracking-installation');
    if (!id) { id = `web-${crypto.randomUUID()}`; localStorage.setItem('eunice-tracking-installation', id); }
    await api.post(`/viajes/${activeTrip.idViaje}/fuente-rastreo`, { idFuente: id, tomarControl: takeControl });
    if (ownerRef.current !== userId || tripRef.current !== activeTrip.idViaje) return;
    sourceRef.current = id; setSourceConflict(false);
  }, [activeTrip, userId]);
  useEffect(() => {
    sourceRef.current = null;
    if (!enabled || !activeTrip) return;
    const timer = window.setTimeout(() => void acquireSource().catch(error => { setSourceConflict(isAxiosError(error) && error.response?.status === 409); }), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, activeTrip, acquireSource, restartToken]);
  const takeTrackingControl = async () => {
    if (!window.confirm('Este navegador reemplazará al dispositivo que comparte el GPS del viaje. ¿Tomar el control?')) return;
    try { await acquireSource(true); }
    catch { onNotify('No se pudo transferir el rastreo. Vuelve a intentar con conexión.', 'error'); }
  };
  const exportPending = () => {
    if (!userId) return;
    try {
      const raw = Object.fromEntries(queuedTrips(userId).map(tripId => [storageKey(userId, tripId), localStorage.getItem(storageKey(userId, tripId))]));
      const blob = new Blob([JSON.stringify({ userId, format: 'eunice-web-recovery-v1', raw }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `eunice-posiciones-${userId}.json`; link.click(); URL.revokeObjectURL(url);
    } catch { onNotify('No se pudo exportar la cola. No se ha eliminado ninguna posición.', 'error'); }
  };

  const navigationRef = useRef(navigation);
  useEffect(() => {
    if (!enabled || !navigation || !tripRef.current) return;
    const trip = currentAssignment.current;
    if (!trip || navigation.tripId !== trip.idViaje) return;
    const timer = window.setTimeout(() => {
      void api.post(`/viajes/${trip.idViaje}/destino`, { lat: navigation.lat, lng: navigation.lng, nombre: navigation.name.slice(0, 150), revision: navigation.revision ?? 0 }, { headers: { 'X-Eunice-User': String(userId) } })
        .then(() => { if (ownerRef.current === userId) onTripInvalidated(); })
        .catch(() => { if (ownerRef.current === userId) onNotify('No se confirmó el destino del viaje. Actualiza la asignación antes de cambiar la guía.', 'warning'); });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, navigation, activeTrip?.idViaje, userId, onNotify, onTripInvalidated]);
  const liveSenderRef = useRef(onLiveTelemetry);
  const lastArchiveFlushRef = useRef(0);
  const notifyRef = useRef(onNotify);
  const flushInFlightRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const retryAfterRef = useRef(0);
  const privacySyncRef = useRef<string | null>(null);
  const lastQueuedAtRef = useRef(0);
  const lastDeviceTimestampRef = useRef(0);
  const previousPositionRef = useRef<{
    lat: number;
    lng: number;
    timestamp: number;
    accuracy: number;
  } | null>(null);
  const lastGpsErrorRef = useRef<number | null>(null);

  useEffect(() => {
    navigationRef.current = navigation;
  }, [navigation]);

  useEffect(() => {
    liveSenderRef.current = onLiveTelemetry;
  }, [onLiveTelemetry]);

  useEffect(() => {
    notifyRef.current = onNotify;
  }, [onNotify]);

  const flushQueue = useCallback(async () => {
    if (!enabled || !userId || isPaused || !navigator.onLine || flushInFlightRef.current) return;
    if (Date.now() < retryAfterRef.current) return;
    flushInFlightRef.current = true;
    try {
      let acknowledged = false;
      await queueLock(userId, async () => {
        for (const tripId of queuedTrips(userId)) {
          if (ownerRef.current !== userId) return;
          const queued = readQueue(userId, tripId);
          const batch = queued.filter(x => !x.rejection).slice(0, BATCH_SIZE);
          if (!batch.length) continue;
          const response = await api.post<{ lecturas: { idLectura: string; estado: string; mensaje?: string }[] }>('/telemetria/delivery',
            batch.map(item => ({ ...item.payload, idViaje: tripId, idLectura: item.id })), { headers: { 'X-Eunice-User': String(userId) } });
          if (!Array.isArray(response.data?.lecturas)) throw new Error('El servidor no confirmó las posiciones.');
          const ids = new Set(batch.map(x => x.id));
          const receipts = response.data.lecturas.filter(x => ids.has(x.idLectura));
          const confirmed = new Set(receipts.filter(x => x.estado === 'aceptada' || x.estado === 'duplicada').map(x => x.idLectura));
          const rejected = new Map(receipts.filter(x => x.estado === 'rechazada').map(x => [x.idLectura, x.mensaje ?? 'Requiere revisión']));
          writeQueue(userId, tripId, readQueue(userId, tripId).filter(x => !confirmed.has(x.id))
            .map(x => rejected.has(x.id) ? { ...x, rejection: rejected.get(x.id) } : x));
          acknowledged ||= confirmed.size > 0;
        }
      });
      if (ownerRef.current !== userId) return;
      const remaining = queuedTrips(userId).flatMap(tripId => readQueue(userId, tripId));
      const quarantined = remaining.filter(x => x.rejection).length;
      setQueueIssue(quarantined ? `${quarantined} posiciones conservadas para revisión. Puedes exportarlas.` : null);
      setQueuedReadings(remaining.length);
      if (acknowledged) setLastSentAt(Date.now());
      retryAttemptRef.current = 0;
      retryAfterRef.current = 0;
      setPhase('tracking');
      setStatusText(quarantined ? `${quarantined} posiciones conservadas para revisión` : remaining.length > 0 ? `Sincronizando ${remaining.length} posiciones` : 'Último envío confirmado');
    } catch (error) {
      if (ownerRef.current !== userId) return;
      const message = getApiMessage(error);
      setQueueIssue(message || 'No se confirmó el envío; las posiciones se conservan.');
      if (isAxiosError(error) && error.response?.status === 409) setSourceConflict(true);
      if (isRetryableRequest(error)) {
        retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 5);
        retryAfterRef.current = Date.now() + Math.min(60_000, 5_000 * (2 ** (retryAttemptRef.current - 1)));
        setPhase(navigator.onLine ? 'error' : 'offline');
        setStatusText(navigator.onLine ? 'Conexión inestable; reintentando automáticamente' : 'Sin internet; guardando el recorrido');
      } else {
        retryAfterRef.current = Date.now() + 60_000;
        setPhase('error');
        setStatusText(message || (error instanceof Error ? error.message : 'Sincronización pendiente; posiciones conservadas'));
      }
    } finally {
      flushInFlightRef.current = false;
    }
  }, [enabled, isPaused, userId]);

  useEffect(() => {
    let active = true;
    if (!enabled || !userId || !activeTrip) {
      queueMicrotask(() => {
        if (active) setQueuedReadings(0);
      });
      return () => {
        active = false;
      };
    }
    let pendingCount = 0;
    try { pendingCount = queuedTrips(userId).reduce((sum, id) => sum + readQueue(userId, id).length, 0); }
    catch (error) { notifyRef.current((error as Error).message, 'error'); }
    queueMicrotask(() => {
      if (active) setQueuedReadings(pendingCount);
    });
    return () => {
      active = false;
    };
  }, [activeTrip, enabled, userId]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      retryAfterRef.current = 0;
      retryAttemptRef.current = 0;
      if (isPaused && activeTrip) {
        void api.post('/telemetria/estado', { isPrivacyMode: true }).catch(() => {});
      } else {
        setStatusText('Internet recuperado; sincronizando recorrido');
        void flushQueue();
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      if (activeTrip && !isPaused) {
        setPhase('offline');
        setStatusText('Sin internet; guardando el recorrido');
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [activeTrip, flushQueue, isPaused]);

  useEffect(() => {
    if (!enabled || !userId || isPaused) return;
    const timer = window.setInterval(() => void flushQueue(), FLUSH_INTERVAL_MS);
    const initialFlush = window.setTimeout(() => void flushQueue(), 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initialFlush);
    };
  }, [activeTrip, enabled, flushQueue, isPaused, userId]);

  useEffect(() => {
    if (!enabled || !activeTrip || !isPaused || !navigator.onLine) return;
    const syncKey = `${activeTrip.idViaje}:true`;
    if (privacySyncRef.current === syncKey) return;
    privacySyncRef.current = syncKey;
    const syncPrivacy = window.setTimeout(() => {
      void api.post('/telemetria/estado', { isPrivacyMode: true }).catch(() => {
        privacySyncRef.current = null;
      });
    }, 0);
    return () => window.clearTimeout(syncPrivacy);
  }, [activeTrip, enabled, isPaused]);

  useEffect(() => {
    if (!enabled || !userId || activeTripLoading || !activeTrip || isPaused) return;
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }
    if (!navigator.geolocation) {
      return;
    }

    const pilotUserId = userId;
    const activeTripId = activeTrip.idViaje;
    const initialStatus = window.setTimeout(() => {
      setPhase(navigator.onLine ? 'locating' : 'offline');
      setStatusText(navigator.onLine ? 'Buscando una señal GPS precisa' : 'Sin internet; el recorrido se guardará en el teléfono');
    }, 0);

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const measuredAccuracy = Math.max(0, Math.round(position.coords.accuracy));
        if (!hasValidCoordinates(lat, lng)) return;

        setAccuracy(measuredAccuracy);
        lastGpsErrorRef.current = null;

        const measuredAt = Number.isFinite(position.timestamp) && position.timestamp > 0
          ? position.timestamp
          : Date.now();
        const previous = previousPositionRef.current;
        if (previous && measuredAt <= previous.timestamp) return;
        if (measuredAccuracy > MAX_ACCEPTED_ACCURACY_METERS) {
          setPhase('weak');
          setStatusText(`Señal GPS débil · precisión ${measuredAccuracy} m`);
          return;
        }
        setLocation({ lat, lng });
        if (sourceConflict) return;
        if (!sourceRef.current) { setStatusText('GPS local · confirmando la fuente del viaje'); return; }
        let calculatedSpeedKmh = position.coords.speed != null && Number.isFinite(position.coords.speed)
          ? Math.max(0, position.coords.speed * 3.6)
          : 0;

        if (position.coords.speed == null && previous) {
          const elapsedSeconds = (measuredAt - previous.timestamp) / 1_000;
          const distanceMeters = getDistanceKm(previous.lat, previous.lng, lat, lng) * 1_000;
          const noiseFloor = Math.max(previous.accuracy, measuredAccuracy, 12);
          if (elapsedSeconds >= 2 && elapsedSeconds <= 60 && distanceMeters > noiseFloor) {
            calculatedSpeedKmh = (distanceMeters / elapsedSeconds) * 3.6;
          }
        }

        const safeSpeed = Math.min(300, Number(calculatedSpeedKmh.toFixed(1)));
        setSpeedKmh(safeSpeed);
        previousPositionRef.current = { lat, lng, timestamp: measuredAt, accuracy: measuredAccuracy };

        if (measuredAccuracy > MAX_ACCEPTED_ACCURACY_METERS) {
          setPhase('weak');
          setStatusText(`Señal GPS débil · precisión ${measuredAccuracy} m`);
          return;
        }

        setPhase(navigator.onLine ? 'tracking' : 'offline');
        setStatusText(navigator.onLine
          ? `GPS activo · precisión ${measuredAccuracy} m`
          : 'Sin internet; guardando el recorrido');

        const now = Date.now();
        if (now - lastQueuedAtRef.current < SEND_INTERVAL_MS) return;
        lastQueuedAtRef.current = now;

        const deviceTimestamp = Math.max(measuredAt, lastDeviceTimestampRef.current + 1);
        lastDeviceTimestampRef.current = deviceTimestamp;
        const currentNavigation = navigationRef.current;
        const payload: TelemetryPayload = {
          ...(sourceRef.current ? { idFuente: sourceRef.current } : {}),
          idViaje: activeTripId,
          precisionMetros: measuredAccuracy,
          sensoresCalibrados: false,
          latitud: Number(lat.toFixed(7)),
          longitud: Number(lng.toFixed(7)),
          velocidadKmh: safeSpeed,
          ...(safeSpeed >= 4 && typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading)
            && position.coords.heading >= 0 && position.coords.heading < 360 ? { heading: position.coords.heading } : {}),
          fechaHoraDispositivo: new Date(deviceTimestamp).toISOString(),
          ...(currentNavigation ? {
            destinoLat: Number(currentNavigation.lat.toFixed(7)),
            destinoLng: Number(currentNavigation.lng.toFixed(7)),
            destinoNombre: currentNavigation.name.slice(0, 150),
          } : {}),
        };
        const sentLive = liveSenderRef.current?.({ ...payload, isTripActive: Boolean(currentNavigation) }) ?? false;
        const item: QueuedReading = {
          id: `${deviceTimestamp}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
          userId: pilotUserId,
          tripId: activeTripId,
          createdAt: now,
          payload,
        };
        try {
          await queueLock(pilotUserId, async () => {
            const nextQueue = [...readQueue(pilotUserId, activeTripId), item];
            writeQueue(pilotUserId, activeTripId, nextQueue);
            setQueuedReadings(nextQueue.length);
          });
        } catch (error) {
          setQueueIssue((error as Error).message);
          setPhase('error'); setStatusText((error as Error).message); return;
        }
        if (!sentLive || now - lastArchiveFlushRef.current >= FLUSH_INTERVAL_MS) {
          lastArchiveFlushRef.current = now;
          void flushQueue();
        }
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        setPhase(denied ? 'blocked' : 'error');
        setStatusText(denied
          ? 'Permiso de ubicación desactivado'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Señal GPS no disponible'
            : 'El GPS tardó demasiado; reintentando');
        if (lastGpsErrorRef.current !== error.code) {
          lastGpsErrorRef.current = error.code;
          notifyRef.current(
            denied
              ? 'Activa el permiso de ubicación del navegador para transmitir este viaje.'
              : 'No se obtuvo una posición GPS precisa. El sistema seguirá reintentando.',
            'warning',
          );
        }
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );

    return () => {
      window.clearTimeout(initialStatus);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [activeTrip, activeTripLoading, enabled, flushQueue, isPaused, restartToken, userId, sourceConflict]);

  const retry = useCallback(() => {
    lastGpsErrorRef.current = null;
    retryAfterRef.current = 0;
    setRestartToken((current) => current + 1);
    void flushQueue();
  }, [flushQueue]);

  const togglePaused = useCallback(async () => {
    if (!enabled || !userId || !activeTrip) return;
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    try {
      localStorage.setItem(privacyKey(userId), String(nextPaused));
    } catch {
      // La preferencia seguirá activa durante esta sesión.
    }
    setPhase(nextPaused ? 'paused' : 'locating');
    setStatusText(nextPaused ? 'Transmisión pausada por el piloto' : 'Reanudando señal GPS');

    // Privacy stops new publication. It never erases already captured history.

    const syncKey = `${activeTrip.idViaje}:${nextPaused}`;
    privacySyncRef.current = syncKey;
    try {
      await api.post('/telemetria/estado', { isPrivacyMode: nextPaused });
      notifyRef.current(
        nextPaused ? 'La ubicación quedó pausada para despacho.' : 'La transmisión de ubicación se reanudó.',
        nextPaused ? 'info' : 'success',
      );
    } catch (error) {
      privacySyncRef.current = null;
      if (navigator.onLine) {
        notifyRef.current(getApiMessage(error) || 'No se pudo sincronizar el estado de privacidad.', 'warning');
      }
    }
  }, [activeTrip, enabled, isPaused, userId]);

  let visiblePhase = phase;
  let visibleStatusText = statusText;
  if (!enabled) {
    visiblePhase = 'inactive';
    visibleStatusText = 'Rastreo disponible únicamente para pilotos';
  } else if (activeTripLoading) {
    visiblePhase = 'locating';
    visibleStatusText = 'Verificando el viaje asignado';
  } else if (!activeTrip) {
    visiblePhase = 'inactive';
    visibleStatusText = 'Esperando un viaje asignado';
  } else if (isPaused) {
    visiblePhase = 'paused';
    visibleStatusText = 'Transmisión pausada por el piloto';
  } else if (sourceConflict) {
    visiblePhase = 'blocked'; visibleStatusText = 'Otro dispositivo comparte este viaje · consulta local';
  } else if (queueIssue) {
    visiblePhase = 'error'; visibleStatusText = queueIssue;
  } else if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    visiblePhase = 'blocked';
    visibleStatusText = 'El GPS requiere abrir el sistema mediante HTTPS';
  } else if (!navigator.geolocation) {
    visiblePhase = 'blocked';
    visibleStatusText = 'Este navegador no admite ubicación GPS';
  }

  return {
    phase: visiblePhase,
    statusText: visibleStatusText,
    location,
    accuracy,
    speedKmh,
    queuedReadings,
    lastSentAt,
    isPaused,
    isOnline,
    retry,
    togglePaused,
    sourceConflict,
    takeTrackingControl,
    exportPending,
  };
};
