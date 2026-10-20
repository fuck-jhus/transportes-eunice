import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { buildWebSocketUrl, DEFAULT_API_URL, VALID_VPS_URLS } from '../api/client';
import { getAuthToken } from './tokenStorage';
import type { FleetSocket } from './fleetConnection';

export const openTelemetrySocket = async (): Promise<FleetSocket> => {
  const saved = await AsyncStorage.getItem('@custom_api_url');
  const base = saved && VALID_VPS_URLS.includes(saved) ? saved : api.defaults.baseURL || DEFAULT_API_URL;
  const token = await getAuthToken();
  if (Platform.OS !== 'web' && !token) throw new Error('No hay sesión para transmitir ubicación.');
  return new (WebSocket as any)(buildWebSocketUrl(base), null,
    Platform.OS === 'web' ? undefined : { headers: { Authorization: `Bearer ${token}` } }) as FleetSocket;
};
