import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { enqueueTelemetry } from './offlineStorage';
import { flushPendingTelemetry } from './telemetryDelivery';
import type { CrearTelemetriaDto } from '../types/telemetry';
import { validHeading } from '../utils/navigationTelemetry';
import { trackingSourceId } from './installationIdentity';

export const BACKGROUND_LOCATION_TASK = 'eunice-background-location';
const CONTEXT_KEY = '@eunice_background_tracking_context';
let transition: Promise<unknown> = Promise.resolve();
let generation = 0;

export interface BackgroundTrackingContext {
  sourceId?: string;
  userId: number;
  tripId: number;
  paused: boolean;
  destination: { lat: number; lng: number; name?: string } | null;
}

export const saveBackgroundTrackingContext = async (context: BackgroundTrackingContext | null) => {
  if (!context) {
    await AsyncStorage.removeItem(CONTEXT_KEY);
    return;
  }
  await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
};

const flushBackgroundQueue = async (context: BackgroundTrackingContext) => {
  const network = await NetInfo.fetch();
  if (network.isConnected !== true || network.isInternetReachable === false) return;
  try { await flushPendingTelemetry(context.userId); }
  catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 409)
      await saveBackgroundTrackingContext({ ...context, paused: true });
    throw error;
  }
};

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error || AppState.currentState === 'active') return;
  try {
    const rawContext = await AsyncStorage.getItem(CONTEXT_KEY);
    if (!rawContext) return;
    const context = JSON.parse(rawContext) as BackgroundTrackingContext;
    if (context.paused || !context.userId || !context.tripId) return;

    const locations = data?.locations ?? [];
    for (const sample of locations) {
      const { latitude, longitude, speed, accuracy, heading } = sample.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (accuracy ?? 999) > 150) continue;
      const payload: CrearTelemetriaDto = {
        idViaje: context.tripId,
        idFuente: await trackingSourceId(),
        sensoresCalibrados: false,
        ...(accuracy != null ? { precisionMetros: Math.max(0, accuracy) } : {}),
        latitud: Number(latitude.toFixed(7)),
        longitud: Number(longitude.toFixed(7)),
        velocidadKmh: Math.min(300, Math.max(0, Number((((speed ?? 0) * 3.6).toFixed(1))))),
        fechaHoraDispositivo: new Date(sample.timestamp || Date.now()).toISOString(),
        ...((speed ?? 0) * 3.6 >= 4 && validHeading(heading) != null ? { heading: heading! } : {}),
        ...(context.destination ? {
          destinoLat: Number(context.destination.lat.toFixed(7)),
          destinoLng: Number(context.destination.lng.toFixed(7)),
          destinoNombre: (context.destination.name || 'Destino seleccionado').slice(0, 150),
        } : {}),
      };
      await enqueueTelemetry(context.userId, context.tripId, payload);
    }
    await flushBackgroundQueue(context);
  } catch {
    // La siguiente actualización reintentará; la cola local conserva las posiciones.
  }
});

const startTracking = async (context: BackgroundTrackingContext, request: number): Promise<boolean> => {
  if (Platform.OS === 'web') return false;

  const foregroundPermission = await Location.getForegroundPermissionsAsync();
  if (foregroundPermission.status !== 'granted') return false;
  const backgroundPermission = await Location.requestBackgroundPermissionsAsync();
  if (backgroundPermission.status !== 'granted') return false;
  if (request !== generation) return false;
  await saveBackgroundTrackingContext(context);
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (!started) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 3_000,
      distanceInterval: 5,
      deferredUpdatesInterval: 3_000,
      deferredUpdatesDistance: 5,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Eunice · viaje en curso',
        notificationBody: 'La ubicación se comparte con despacho mientras el viaje permanezca activo.',
        notificationColor: '#d85f28',
        killServiceOnDestroy: false,
      },
    });
  }
  return true;
};

export const startBackgroundTracking = (context: BackgroundTrackingContext): Promise<boolean> => {
  const request = ++generation;
  const task = transition.catch(() => {}).then(() => request === generation ? startTracking(context, request) : false);
  transition = task;
  return task;
};

export const stopBackgroundTracking = () => {
  generation++;
  const task = transition.catch(() => {}).then(async () => {
    await saveBackgroundTrackingContext(null);
    if (Platform.OS === 'web') return;
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  });
  transition = task;
  return task;
};
