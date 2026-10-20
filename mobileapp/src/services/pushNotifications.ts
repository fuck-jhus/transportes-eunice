import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import api from '../api/client';
import { getAuthToken } from './tokenStorage';

const PUSH_TOKEN_KEY = '@eunice_expo_push_token';
const INSTALLATION_ID_KEY = '@eunice_installation_id';
// A late permission dialog must not bind a logged-out account or remove the next account's token.
let registrationQueue: Promise<unknown> = Promise.resolve();
let sessionGeneration = 0;
let installationPromise: Promise<string> | undefined;
const serial = <T,>(work: () => Promise<T>): Promise<T> => {
  const result = registrationQueue.then(work, work);
  registrationQueue = result.catch(() => {});
  return result;
};

Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const sessionToken = await getAuthToken().catch(() => null);
    let signedIn = Boolean(sessionToken);
    if (signedIn && notification.request.content.data?.recipientId != null) {
      try {
        const user = JSON.parse(await AsyncStorage.getItem('@user_session') ?? 'null');
        signedIn = Boolean(user && isPushForUser(notification.request.content.data, user.idUsuario)
          && await getAuthToken() === sessionToken);
      } catch { signedIn = false; }
    }
    return { shouldPlaySound: signedIn, shouldSetBadge: false,
      shouldShowBanner: signedIn, shouldShowList: signedIn };
  },
});

export type PushRegistrationStatus = 'registered' | 'denied' | 'simulator' | 'unsupported' | 'cancelled' | 'error';
type RegistrationOptions = { isCurrent?: () => boolean; requestPermission?: boolean };

export const isPushForUser = (data: Record<string, unknown> | undefined, userId: number): boolean =>
  data?.recipientId == null || Number(data.recipientId) === userId;

const getInstallationId = (): Promise<string> => installationPromise ??= (async () => {
  const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const generated = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, generated);
  return generated;
})().catch(error => { installationPromise = undefined; throw error; });

export const registerPushNotificationsAsync = (options: RegistrationOptions = {}): Promise<PushRegistrationStatus> => {
  // Capture before joining the queue; never adopt another user's token after an await.
  const generation = sessionGeneration;
  const auth = getAuthToken().catch(() => null);
  return (async () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
    if (!Device.isDevice) return 'simulator';
    const sessionToken = await auth;
    const current = async () => Boolean(sessionToken) && generation === sessionGeneration
      && options.isCurrent?.() !== false && await getAuthToken() === sessionToken;
    try {
      if (!await current()) return 'cancelled';
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('operaciones', {
          name: 'Operaciones en tiempo real',
          description: 'Mensajes, asignaciones y avisos de la operación.',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 180, 250], lightColor: '#D85F28', sound: 'default',
        });
      }
      let permissions = await Notifications.getPermissionsAsync();
      const allowed = () => permissions.granted || (Platform.OS === 'ios'
        && permissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
      if (!allowed() && permissions.canAskAgain && options.requestPermission !== false) {
        permissions = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
      }
      if (!await current()) return 'cancelled';
      if (!allowed()) return 'denied';
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) return 'error';
      const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      const installationId = await getInstallationId();
      // Do not hold the registration queue while iOS displays a permission dialog.
      return await serial(async (): Promise<PushRegistrationStatus> => {
        if (!await current()) return 'cancelled';
        const headers = { Authorization: `Bearer ${sessionToken}` };
        await api.post('/notificaciones/dispositivos', {
          expoPushToken: pushToken, plataforma: Platform.OS, deviceId: installationId,
        }, { headers, timeout: 4_000 });
        if (!await current()) {
          // Compensate a request that reached the server while this session was closing.
          await api.delete('/notificaciones/dispositivos', { data: { expoPushToken: pushToken }, headers, timeout: 1_500 }).catch(() => {});
          return 'cancelled';
        }
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, pushToken);
        return 'registered';
      });
    } catch {
      // Axios errors contain bearer credentials and device tokens: never log them.
      return await current().catch(() => false) ? 'error' : 'cancelled';
    }
  })();
};

/** Retry transient failures; refresh on token rotation, connection recovery and return from
 * Settings. Only the initial attempt may show the system permission prompt. */
export const maintainPushRegistration = (onStatus: (status: PushRegistrationStatus) => void): (() => void) => {
  if (Platform.OS === 'web') return () => {};
  let stopped = false;
  let pending = false;
  let rerun = false;
  let failures = 0;
  let lastSuccess = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStatus: PushRegistrationStatus | undefined;
  const attempt = async (initial = false, force = false) => {
    if (stopped) return;
    if (pending) { rerun = true; return; }
    if (!force && Date.now() - lastSuccess < 60_000) return;
    if (timer) clearTimeout(timer);
    pending = true;
    try {
      const status = await registerPushNotificationsAsync({ isCurrent: () => !stopped, requestPermission: initial });
      if (stopped) return;
      if (status !== lastStatus) onStatus(status);
      lastStatus = status;
      if (status === 'registered') { failures = 0; lastSuccess = Date.now(); }
      if (status === 'error') {
        const delay = Math.min(600_000, 5_000 * 2 ** Math.min(failures++, 7));
        timer = setTimeout(() => { void attempt(); }, delay);
      }
    } finally {
      pending = false;
      if (rerun && !stopped) { rerun = false; void attempt(false, true); }
    }
  };
  let wasOnline: boolean | undefined;
  const network = NetInfo.addEventListener(state => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    if (online && wasOnline === false) void attempt();
    wasOnline = online;
  });
  const appState = AppState.addEventListener('change', state => { if (state === 'active') void attempt(false, true); });
  const token = Notifications.addPushTokenListener(() => { void attempt(false, true); });
  void attempt(true);
  return () => { stopped = true; if (timer) clearTimeout(timer); network(); appState.remove(); token.remove(); };
};

export const unregisterPushNotificationsAsync = (sessionToken?: string | null): Promise<void> => {
  sessionGeneration++;
  return serial(async () => {
    const pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    try {
      if (pushToken && sessionToken) {
        await api.delete('/notificaciones/dispositivos', {
          data: { expoPushToken: pushToken }, timeout: 1_500,
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
      }
    } finally {
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
      if (Platform.OS !== 'web') {
        await Promise.allSettled([Notifications.dismissAllNotificationsAsync(), Notifications.setBadgeCountAsync(0),
          Notifications.clearLastNotificationResponseAsync()]);
      }
    }
  });
};

export const subscribeToPushResponses = (listener: (response: Notifications.NotificationResponse) => void) =>
  Notifications.addNotificationResponseReceivedListener(listener);
export const subscribeToPushNotifications = (listener: (notification: Notifications.Notification) => void) =>
  Notifications.addNotificationReceivedListener(listener);
export const consumeInitialPushResponseAsync = async (): Promise<Notifications.NotificationResponse | null> => {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (response) await Notifications.clearLastNotificationResponseAsync();
  return response;
};
