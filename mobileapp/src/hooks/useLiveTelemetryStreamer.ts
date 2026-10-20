import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isAxiosError } from 'axios';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import NetInfo from '@react-native-community/netinfo';
import api from '../api/client';
import { createFleetConnection } from '../services/fleetConnection';
import { openTelemetrySocket } from '../services/openTelemetrySocket';
import { canUseLocalGps, canPublishTelemetry, validHeading, resolveNavigationHeading, smoothHeading } from '../utils/navigationTelemetry';
import { estimateGpsPosition } from '../utils/routeProgress';
import type { NavigationFix } from '../types/navigation';
import { enqueueTelemetry } from '../services/offlineStorage';
import { flushPendingTelemetry, pendingTelemetryCount } from '../services/telemetryDelivery';
import { isGpsFresh } from '../utils/trackingFreshness';
import { acquireTrackingSource, trackingSourceId } from '../services/trackingSource';
import {
  saveBackgroundTrackingContext,
  startBackgroundTracking,
  stopBackgroundTracking,
} from '../services/backgroundTelemetry';
import type {
  CrearTelemetriaDto,
  MobileTrackingSnapshot,
  UserSession,
  ViajeActivo,
} from '../types/telemetry';

const SEND_INTERVAL_MS = 1_000;
const FLUSH_INTERVAL_MS = 5_000;
const TRIP_REFRESH_INTERVAL_MS = 30_000;
const MAX_ACCEPTED_ACCURACY_METERS = 150;

type NavigationDestination = { lat: number; lng: number; name?: string } | null;

const distanceKm = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
  const radiusKm = 6371;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getApiMessage = (error: unknown) => {
  if (!isAxiosError<{ mensaje?: string }>(error)) return '';
  return error.response?.data?.mensaje ?? '';
};

const isRetryable = (error: unknown) => {
  if (!isAxiosError(error)) return false;
  return !error.response || error.response.status === 408 || error.response.status === 429 || error.response.status >= 500;
};

export const useLiveTelemetryStreamer = (
  user: UserSession | null,
  liveDestination?: NavigationDestination,
  liveTripActive = false,
  isPrivacyMode = false,
): MobileTrackingSnapshot => {
  const canStream = user?.tipoRol === 'Piloto';
  const [phase, setPhase] = useState<MobileTrackingSnapshot['phase']>('inactive');
  const [statusText, setStatusText] = useState('Esperando un viaje asignado');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [heading, setHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [queuedReadings, setQueuedReadings] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [assignment, setAssignment] = useState<{ userId?: number; trip: ViajeActivo | null }>({ trip: null });
  const assignedTrip = assignment.userId === user?.idUsuario ? assignment.trip : null;
  const setAssignedTrip = useCallback((next: React.SetStateAction<ViajeActivo | null>) => {
    setAssignment(previous => ({ userId: user?.idUsuario, trip: typeof next === 'function'
      ? next(previous.userId === user?.idUsuario ? previous.trip : null) : next }));
  }, [user?.idUsuario]);
  const [restartToken, setRestartToken] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [foregroundGranted, setForegroundGranted] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState<MobileTrackingSnapshot['backgroundStatus']>('inactive');
  const [queueError, setQueueError] = useState<string | null>(null);
  const [permissionRevision, setPermissionRevision] = useState(0);
  const [assignmentConfirmedFor, setAssignmentConfirmedFor] = useState<number>();
  const [sourceConflict, setSourceConflict] = useState(false);
  const sourceReady = useRef<number | null>(null);
  const takeTrackingControl = useCallback(async () => {
    if (!assignedTrip) return;
    try {
      await acquireTrackingSource(assignedTrip.idViaje, true);
      sourceReady.current = assignedTrip.idViaje; setSourceConflict(false); setQueueError(null);
    } catch { setQueueError('No se pudo transferir el rastreo. Revisa la conexión y vuelve a intentar.'); }
  }, [assignedTrip]);
  useEffect(() => {
    let cancelled = false;
    sourceReady.current = null;
    setSourceConflict(false);
    if (!assignedTrip || !canStream) return;
    void acquireTrackingSource(assignedTrip.idViaje).then(() => { if (!cancelled) sourceReady.current = assignedTrip.idViaje; })
      .catch(error => { if (!cancelled) { setSourceConflict(error?.response?.status === 409); setQueueError(getApiMessage(error) || 'Rastreo pendiente de conexión; GPS local disponible.'); } });
    return () => { cancelled = true; };
  }, [assignedTrip?.idViaje, canStream, restartToken, permissionRevision]);
  const publicationAllowed = useRef(false);
  const currentUserId = useRef(user?.idUsuario);
  currentUserId.current = user?.idUsuario;
  publicationAllowed.current = canStream && Boolean(user) && !isPrivacyMode;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 3_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') setPermissionRevision(value => value + 1); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  useEffect(() => {
    let active = true;
    setQueuedReadings(0);
    if (user) void pendingTelemetryCount(user.idUsuario).then(count => { if (active) setQueuedReadings(count); })
      .catch(() => { if (active) setQueueError('No se pudo leer la cola local. No se eliminó ninguna posición.'); });
    return () => { active = false; };
  }, [user?.idUsuario]);

  const destinationRef = useRef<NavigationDestination>(liveDestination ?? null);
  const tripActiveRef = useRef(liveTripActive);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const speedRef = useRef(0);
  const sensorRef = useRef({ accelX: 0, accelY: 0, accelZ: 0, gyroX: 0, gyroY: 0, gyroZ: 0 });
  const gravityRef = useRef({ x: 0, y: 0, z: 9.81 });
  const previousPositionRef = useRef<{ lat: number; lng: number; timestamp: number; accuracy: number } | null>(null);
  const displayFixRef = useRef<NavigationFix | null>(null);
  const lastQueuedAtRef = useRef(0);
  const lastDeviceTimestampRef = useRef(0);
  const flushInFlightRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const retryAfterRef = useRef(0);
  const headingRef = useRef<number | null>(null);
  const compassRef = useRef<number | null>(null);
  const courseRef = useRef<number | null>(null);
  const liveConnectionRef = useRef<ReturnType<typeof createFleetConnection> | null>(null);
  const lastArchiveFlushRef = useRef(0);

  useEffect(() => {
    if (!canPublishTelemetry(user?.tipoRol, assignedTrip?.idViaje, isPrivacyMode)) return;
    const connection = createFleetConnection({ open: openTelemetrySocket, sync: () => {}, onMessage: () => {} });
    liveConnectionRef.current = connection;
    const stateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') connection.resume();
    });
    return () => {
      liveConnectionRef.current = null;
      connection.stop();
      stateSubscription.remove();
    };
  }, [user?.idUsuario, user?.tipoRol, assignedTrip?.idViaje, isPrivacyMode]);

  useEffect(() => {
    destinationRef.current = liveDestination ?? null;
    tripActiveRef.current = liveTripActive;
  }, [liveDestination, liveTripActive]);

  useEffect(() => {
    let cancelled = false;
    if (!canStream || !user || !assignedTrip || !foregroundGranted || sourceConflict) {
      setBackgroundStatus('inactive');
      void stopBackgroundTracking();
      return;
    }

    const context = {
      userId: user.idUsuario,
      tripId: assignedTrip.idViaje,
      paused: isPrivacyMode,
      destination: liveTripActive ? (liveDestination ?? null) : null,
    };

    if (isPrivacyMode) {
      setBackgroundStatus('inactive');
      void stopBackgroundTracking();
      return;
    }

    setBackgroundStatus('starting');
    void startBackgroundTracking(context).then(started => {
      if (!cancelled) setBackgroundStatus(started ? 'active' : 'denied');
    }).catch(() => { if (!cancelled) setBackgroundStatus('error'); });
    return () => {
      cancelled = true;
      void stopBackgroundTracking().catch(() => {});
    };
  }, [assignedTrip?.idViaje, canStream, isPrivacyMode, user, foregroundGranted, restartToken, permissionRevision, sourceConflict]);

  useEffect(() => {
    if (!canStream || !user || !assignedTrip || isPrivacyMode || sourceConflict) return;
    void saveBackgroundTrackingContext({
      userId: user.idUsuario,
      tripId: assignedTrip.idViaje,
      paused: false,
      destination: liveTripActive ? (liveDestination ?? null) : null,
    });
  }, [assignedTrip, canStream, isPrivacyMode, liveDestination, liveTripActive, user, sourceConflict]);

  const refreshAssignedTrip = useCallback(async () => {
    if (!canStream) {
      setAssignedTrip(null);
      return;
    }

    try {
      const response = await api.get<ViajeActivo>('/viajes/activo-piloto');
      if (currentUserId.current !== user?.idUsuario) return;
      setAssignmentConfirmedFor(user?.idUsuario);
      if (response.status === 204 || !response.data) {
        setAssignedTrip(null);
        return;
      }
      setAssignedTrip((current) => JSON.stringify(current) === JSON.stringify(response.data) ? current : response.data);
    } catch (error) {
      if (currentUserId.current !== user?.idUsuario) return;
      if (isAxiosError(error) && error.response?.status === 404) {
        setAssignmentConfirmedFor(user?.idUsuario);
        setAssignedTrip(null);
      }
    }
  }, [canStream, user?.idUsuario]);

  useEffect(() => {
    void refreshAssignedTrip();
    if (!canStream) return;
    const timer = setInterval(() => void refreshAssignedTrip(), TRIP_REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAssignedTrip();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [canStream, refreshAssignedTrip]);

  const flushQueue = useCallback(async () => {
    if (!canStream || !user || isPrivacyMode || !isOnline || flushInFlightRef.current) return;
    if (assignedTrip && sourceReady.current !== assignedTrip.idViaje && !sourceConflict) return;
    if (Date.now() < retryAfterRef.current) return;
    flushInFlightRef.current = true;

    try {
      const { remaining, sent, quarantined } = await flushPendingTelemetry(user.idUsuario, () => publicationAllowed.current && currentUserId.current === user.idUsuario);
      if (currentUserId.current !== user.idUsuario) return;
      setQueuedReadings(remaining);
      setQueueError(quarantined > 0 ? `${quarantined} posiciones requieren revisión. Se conservan sin bloquear las demás.` : null);
      if (sent) setLastSentAt(Date.now());
      retryAttemptRef.current = 0;
      retryAfterRef.current = 0;
    } catch (error) {
      if (currentUserId.current !== user.idUsuario) return;
      const message = getApiMessage(error);
      if (isAxiosError(error) && error.response?.status === 409) { sourceReady.current = null; setSourceConflict(true); }
      setQueueError(message || 'No se pudieron sincronizar las posiciones. Se conservan para reintentar.');
      if (isRetryable(error)) {
        retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 5);
        retryAfterRef.current = Date.now() + Math.min(60_000, 5_000 * (2 ** (retryAttemptRef.current - 1)));
        setPhase(isOnline ? 'error' : 'offline');
        setStatusText(isOnline ? 'Conexión inestable; reintentando automáticamente' : 'Sin internet; guardando el recorrido');
      } else {
        retryAfterRef.current = Date.now() + 60_000;
        setPhase('error');
        setStatusText('Hay posiciones pendientes de revisión; se conservan en el dispositivo');
      }
    } finally {
      flushInFlightRef.current = false;
    }
  }, [assignedTrip, canStream, isOnline, isPrivacyMode, user]);

  const queueReading = useCallback(async (
    coordinates: { lat: number; lng: number },
    destinationOverride?: NavigationDestination,
    tripActiveOverride?: boolean,
    measuredAt?: number,
  ) => {
    if (!user || !assignedTrip || !canPublishTelemetry(user.tipoRol, assignedTrip.idViaje, isPrivacyMode)) return;
    if (sourceConflict) return;
    const now = Date.now();
    const timestamp = Math.max(measuredAt ?? now, lastDeviceTimestampRef.current + 1);
    lastDeviceTimestampRef.current = timestamp;
    const destination = destinationOverride !== undefined ? destinationOverride : destinationRef.current;
    const hasActiveNavigation = tripActiveOverride !== undefined ? tripActiveOverride : tripActiveRef.current;
    const sensors = sensorRef.current;
    const sourceId = await trackingSourceId();
    if (currentUserId.current !== user.idUsuario || !publicationAllowed.current) return;
    const payload: CrearTelemetriaDto = {
      idViaje: assignedTrip.idViaje,
      idFuente: sourceId,
      sensoresCalibrados: false,
      ...(accuracy != null ? { precisionMetros: accuracy } : {}),
      latitud: Number(coordinates.lat.toFixed(7)),
      longitud: Number(coordinates.lng.toFixed(7)),
      velocidadKmh: Number(speedRef.current.toFixed(1)),
      aceleracionX: sensors.accelX,
      aceleracionY: sensors.accelY,
      aceleracionZ: sensors.accelZ,
      giroscopioX: sensors.gyroX,
      giroscopioY: sensors.gyroY,
      giroscopioZ: sensors.gyroZ,
      ...(headingRef.current != null ? { heading: headingRef.current } : {}),
      fechaHoraDispositivo: new Date(timestamp).toISOString(),
      ...(hasActiveNavigation && destination ? {
        destinoLat: Number(destination.lat.toFixed(7)),
        destinoLng: Number(destination.lng.toFixed(7)),
        destinoNombre: (destination.name || 'Destino seleccionado').slice(0, 150),
      } : {}),
    };
    // Live fan-out does not wait on disk or a REST batch. REST remains the durable
    // history/alert path, and immediate fallback when the socket is unavailable.
    const sentLive = sourceReady.current === assignedTrip.idViaje
      && (liveConnectionRef.current?.send({ tipo: 'telemetria', ...payload, isTripActive: hasActiveNavigation }) ?? false);
    try {
      await enqueueTelemetry(user.idUsuario, assignedTrip.idViaje, payload);
      setQueuedReadings(count => count + 1);
    } catch {
      setQueueError('No se pudo guardar una posición. Revisa el espacio disponible del dispositivo.');
      return;
    }
    if (!sentLive || now - lastArchiveFlushRef.current >= FLUSH_INTERVAL_MS) {
      lastArchiveFlushRef.current = now;
      void flushQueue();
    }
  }, [assignedTrip, canStream, flushQueue, isPrivacyMode, user, sourceConflict, accuracy]);

  // A dispatch change must not stop/restart the local GPS subscription.
  const queueReadingRef = useRef(queueReading);
  queueReadingRef.current = queueReading;
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;

  const streamTelemetryNow = useCallback((
    overrideCoords?: { lat: number; lng: number },
    overrideDestination?: NavigationDestination,
    overrideTripActive?: boolean,
  ) => {
    const coordinates = overrideCoords ?? coordsRef.current;
    if (!coordinates || !isGpsFresh(previousPositionRef.current?.timestamp)) return;
    void queueReading(coordinates, overrideDestination, overrideTripActive, previousPositionRef.current?.timestamp);
  }, [queueReading]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);
      if (online) {
        retryAfterRef.current = 0;
        retryAttemptRef.current = 0;
        void flushQueue();
      } else if (assignedTrip && !isPrivacyMode) {
        setPhase('offline');
        setStatusText('Sin internet; guardando el recorrido');
      }
    });
    return unsubscribe;
  }, [assignedTrip, flushQueue, isPrivacyMode]);

  useEffect(() => {
    if (!canStream || !user || !assignedTrip) return;
    if (isPrivacyMode) {
      coordsRef.current = null;
      setLocation(null);
      setSpeedKmh(0);
      setPhase('paused');
      setStatusText('Transmisión pausada por privacidad');
    } else {
      setPhase('locating');
      setStatusText('Reanudando señal GPS');
    }
    void api.post('/telemetria/estado', { isPrivacyMode }).catch(() => {
      setPhase('error');
      setStatusText('No se pudo sincronizar el estado de privacidad');
    });
  }, [assignedTrip, canStream, isPrivacyMode, user]);

  useEffect(() => {
    if (!canStream || !user || isPrivacyMode) return;
    const flushTimer = setInterval(() => void flushQueue(), FLUSH_INTERVAL_MS);
    void flushQueue();
    return () => clearInterval(flushTimer);
  }, [assignedTrip, canStream, flushQueue, isPrivacyMode]);

  useEffect(() => {
    if (!canStream || !assignedTrip || isPrivacyMode) return;
    let accelerationSubscription: { remove: () => void } | null = null;
    let gyroscopeSubscription: { remove: () => void } | null = null;

    Accelerometer.setUpdateInterval(100);
    accelerationSubscription = Accelerometer.addListener((sample) => {
      const raw = { x: sample.x * 9.81, y: sample.y * 9.81, z: sample.z * 9.81 };
      const gravity = gravityRef.current;
      gravity.x = gravity.x * 0.9 + raw.x * 0.1;
      gravity.y = gravity.y * 0.9 + raw.y * 0.1;
      gravity.z = gravity.z * 0.9 + raw.z * 0.1;
      sensorRef.current.accelX = Number((raw.x - gravity.x).toFixed(2));
      sensorRef.current.accelY = Number((raw.y - gravity.y).toFixed(2));
      sensorRef.current.accelZ = Number((raw.z - gravity.z).toFixed(2));
    });

    Gyroscope.setUpdateInterval(100);
    gyroscopeSubscription = Gyroscope.addListener((sample) => {
      sensorRef.current.gyroX = Number(sample.x.toFixed(2));
      sensorRef.current.gyroY = Number(sample.y.toFixed(2));
      sensorRef.current.gyroZ = Number(sample.z.toFixed(2));
    });

    return () => {
      accelerationSubscription?.remove();
      gyroscopeSubscription?.remove();
    };
  }, [assignedTrip, canStream, isPrivacyMode]);

  useEffect(() => {
    previousPositionRef.current = null;
    lastQueuedAtRef.current = 0;
    headingRef.current = null;
    compassRef.current = null;
    courseRef.current = null;
    displayFixRef.current = null;
    if (!canUseLocalGps(user?.tipoRol, isPrivacyMode)) {
      coordsRef.current = null;
      previousPositionRef.current = null;
      headingRef.current = null;
      compassRef.current = null;
      courseRef.current = null;
      speedRef.current = 0;
      setLocation(null);
      setHeading(null);
      setSpeedKmh(0);
      return;
    }
    let subscription: Location.LocationSubscription | null = null;
    let compassSubscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    const startTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission.status !== 'granted') {
        setForegroundGranted(false);
        setPhase('blocked');
        setStatusText('Permiso de ubicación desactivado');
        return;
      }
      setForegroundGranted(true);

      setPhase('locating');
      setStatusText('Buscando una señal GPS precisa');
      try {
        compassSubscription = await Location.watchHeadingAsync((sample) => {
          if (cancelled || sample.accuracy < 1) return;
          const compass = validHeading(sample.trueHeading) ?? validHeading(sample.magHeading);
          if (compass == null) return;
          compassRef.current = compass;
          if (speedRef.current < 4) {
            headingRef.current = smoothHeading(headingRef.current, compass);
            setHeading(headingRef.current);
          }
        });
        if (cancelled) { compassSubscription.remove(); return; }
      } catch { /* Compass may not exist on a device; GPS course still works. */ }
      if (cancelled) return;
      subscription = await Location.watchPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1_000,
        distanceInterval: 1,
      }, (sample) => {
        if (cancelled) return;
        const nextLocation = { lat: sample.coords.latitude, lng: sample.coords.longitude };
        const measuredAccuracy = Math.max(0, Math.round(sample.coords.accuracy ?? 999));
        const measuredAt = sample.timestamp > 0 ? sample.timestamp : Date.now();
        const previous = previousPositionRef.current;
        if (previous && measuredAt <= previous.timestamp) return;
        if (measuredAccuracy > MAX_ACCEPTED_ACCURACY_METERS) {
          setAccuracy(measuredAccuracy);
          setPhase('weak');
          setStatusText(`Señal GPS débil · precisión ${measuredAccuracy} m`);
          return;
        }
        let nextSpeed = sample.coords.speed != null && sample.coords.speed >= 0
          ? sample.coords.speed * 3.6
          : 0;

        if ((sample.coords.speed == null || sample.coords.speed < 0) && previous) {
          const elapsedSeconds = (measuredAt - previous.timestamp) / 1_000;
          const distanceMeters = distanceKm(previous, nextLocation) * 1_000;
          const noiseFloor = Math.max(previous.accuracy, measuredAccuracy, 12);
          if (elapsedSeconds >= 2 && elapsedSeconds <= 60 && distanceMeters > noiseFloor) {
            nextSpeed = (distanceMeters / elapsedSeconds) * 3.6;
          }
        }

        nextSpeed = Math.min(300, Math.max(0, Number(nextSpeed.toFixed(1))));
        coordsRef.current = nextLocation;
        speedRef.current = nextSpeed;
        const fix = { ...nextLocation, timestamp: measuredAt, accuracy: measuredAccuracy };
        const nextHeading = resolveNavigationHeading(sample.coords.heading, nextSpeed, previous, fix, compassRef.current, courseRef.current);
        if (nextHeading != null) {
          headingRef.current = smoothHeading(headingRef.current, nextHeading);
          if (nextSpeed >= 4) courseRef.current = headingRef.current;
        }
        previousPositionRef.current = fix;
        displayFixRef.current = estimateGpsPosition(displayFixRef.current, { ...fix, speedKmh: nextSpeed, heading: headingRef.current });
        setLocation(nextLocation);
        setAccuracy(measuredAccuracy);
        setSpeedKmh(nextSpeed);
        setHeading(headingRef.current);

        setPhase(onlineRef.current ? 'tracking' : 'offline');
        setStatusText(onlineRef.current ? `GPS activo · precisión ${measuredAccuracy} m` : 'Sin internet; GPS local activo');
        const now = Date.now();
        if (now - lastQueuedAtRef.current >= SEND_INTERVAL_MS) {
          lastQueuedAtRef.current = now;
          void queueReadingRef.current(nextLocation, undefined, undefined, measuredAt);
        }
      });
      if (cancelled) subscription.remove();
    };

    void startTracking().catch(() => {
      if (!cancelled) {
        setPhase('error');
        setStatusText('No se pudo iniciar el GPS; toca reintentar');
      }
    });

    return () => {
      cancelled = true;
      subscription?.remove();
      compassSubscription?.remove();
    };
  }, [user?.idUsuario, user?.tipoRol, isPrivacyMode, restartToken]);

  const retry = useCallback(() => {
    retryAttemptRef.current = 0;
    retryAfterRef.current = 0;
    setRestartToken((current) => current + 1);
    void refreshAssignedTrip();
    void flushQueue();
  }, [flushQueue, refreshAssignedTrip]);

  let visiblePhase = phase;
  let visibleStatus = statusText;
  const locationFresh = Boolean(location && isGpsFresh(previousPositionRef.current?.timestamp, clock));
  if (!canStream) {
    visiblePhase = 'inactive';
    visibleStatus = 'Monitoreo de flota habilitado';
  } else if (isPrivacyMode) {
    visiblePhase = 'paused';
    visibleStatus = 'GPS y transmisión pausados por privacidad';
  } else if (location && !locationFresh) {
    visiblePhase = 'stale';
    visibleStatus = 'Sin lectura GPS reciente · mostrando la última ubicación';
  } else if (!assignedTrip && (phase === 'tracking' || phase === 'offline')) {
    visibleStatus = phase === 'offline' ? 'Sin internet · GPS local, sin compartir con la flota' : 'GPS local · sin compartir con la flota';
  } else if (sourceConflict) {
    visiblePhase = 'blocked'; visibleStatus = 'GPS local · otro dispositivo comparte este viaje';
  } else if (queueError) {
    visiblePhase = 'error';
    visibleStatus = 'GPS local activo · sincronización requiere atención';
  } else if (assignedTrip && (!lastSentAt || clock - lastSentAt > 30_000 || queuedReadings > 10)) {
    visibleStatus = 'GPS local activo · guardando posiciones pendientes de confirmación';
  }

  return {
    phase: visiblePhase,
    statusText: visibleStatus,
    location,
    displayLocation: location && displayFixRef.current ? { lat: displayFixRef.current.lat, lng: displayFixRef.current.lng } : null,
    locationTimestamp: location ? previousPositionRef.current?.timestamp ?? null : null,
    locationFresh,
    backgroundStatus,
    queueError,
    speedKmh,
    heading,
    accuracy,
    queuedReadings,
    lastSentAt,
    assignedTrip,
    assignmentConfirmed: assignmentConfirmedFor === user?.idUsuario,
    sourceConflict,
    takeTrackingControl,
    retry,
    streamTelemetryNow,
  };
};
