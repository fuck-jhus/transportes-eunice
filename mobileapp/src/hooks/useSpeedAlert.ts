import { useEffect, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { initialSpeedAlert, nextSpeedAlert, SPEED_LIMIT_KMH, type SpeedAlertState } from '../utils/speedAlert';

const CHANNEL_ID = 'alertas-velocidad';
const VIBRATION_PATTERN = [0, 500, 200, 500, 200, 700];
let channelReady: Promise<unknown> | null = null;

const ensureChannel = () => {
  if (Platform.OS !== 'android') return Promise.resolve();
  return channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Alertas de velocidad',
    description: 'Aviso inmediato cuando el autobús pasa el límite de velocidad.',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: VIBRATION_PATTERN,
    lightColor: '#B23A2E',
    sound: 'default',
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => { channelReady = null; });
};

const notifySpeeding = async (userId: number, speedKmh: number) => {
  Vibration.vibrate(VIBRATION_PATTERN);
  try {
    await ensureChannel();
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ Exceso de velocidad',
        body: `Vas a ${speedKmh} km/h y el límite es ${SPEED_LIMIT_KMH} km/h. Reduce la velocidad.`,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: 'speed_alert', tab: 'telemetry', recipientId: userId },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // Sin permiso de notificaciones quedan el aviso en pantalla y la vibración.
  }
};

/** Vigila la velocidad del piloto durante un viaje y avisa al pasar el límite. */
export const useSpeedAlert = (userId: number | undefined, speedKmh: number, fresh: boolean, enabled: boolean,
  readingAt?: number | null): SpeedAlertState => {
  const [state, setState] = useState<SpeedAlertState>(initialSpeedAlert);
  const stateRef = useRef(state);
  useEffect(() => {
    const { state: next, notify } = nextSpeedAlert(stateRef.current, { speedKmh, fresh, enabled: enabled && userId != null, now: Date.now() });
    stateRef.current = next;
    setState(next);
    if (notify && userId != null) void notifySpeeding(userId, next.speedKmh);
  }, [speedKmh, fresh, enabled, userId, readingAt]);
  useEffect(() => () => Vibration.cancel(), []);
  return state;
};
