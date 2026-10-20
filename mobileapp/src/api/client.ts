import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthToken } from '../services/tokenStorage';
import { notifySessionExpired, shouldRetryRequest } from '../services/authEvents';

export const API_PATH_PREFIX = '/api';

export const normalizeApiBaseUrl = (value: string) => {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) return API_PATH_PREFIX;
  return normalized.toLowerCase().endsWith(API_PATH_PREFIX)
    ? normalized
    : `${normalized}${API_PATH_PREFIX}`;
};

export const getApiOrigin = (apiBaseUrl: string) => {
  const normalizedApiUrl = normalizeApiBaseUrl(apiBaseUrl);
  return normalizedApiUrl.slice(0, -API_PATH_PREFIX.length).replace(/\/+$/, '');
};

export const buildWebSocketUrl = (apiBaseUrl: string) => {
  const httpOrigin = getApiOrigin(apiBaseUrl);
  return `${httpOrigin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')}/ws`;
};

// Variables públicas de Expo: contienen destinos, nunca credenciales.
// La copia pública requiere configurar su propio backend antes de conectarse.
const configuredApiUrl = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_API_URL : undefined;
const configuredFallbackUrl = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_API_FALLBACK_URL : undefined;
export const PRODUCTION_API_URL = normalizeApiBaseUrl(configuredApiUrl || 'https://api.example.invalid');

// El destino alternativo, si se utiliza, debe pertenecer al mismo despliegue.
export const WWW_PRODUCTION_API_URL = normalizeApiBaseUrl(configuredFallbackUrl || configuredApiUrl || 'https://api.example.invalid');

// URL Predeterminada de la Aplicación: Servidor VPS
export const DEFAULT_API_URL = PRODUCTION_API_URL;

const api = axios.create({
  baseURL: DEFAULT_API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Lista estricta de URLs válidas permitidas (Exclusivamente servidores VPS)
export const VALID_VPS_URLS = [PRODUCTION_API_URL, WWW_PRODUCTION_API_URL];

// Interceptor para inyectar token y garantizar conexión exclusiva al VPS
api.interceptors.request.use(
  async (config) => {
    try {
      let customUrl = await AsyncStorage.getItem('@custom_api_url');
      // Si la URL guardada es local, null o ajena al VPS, purgarla y forzar el VPS
      if (!customUrl || !VALID_VPS_URLS.includes(customUrl)) {
        customUrl = DEFAULT_API_URL;
        await AsyncStorage.setItem('@custom_api_url', DEFAULT_API_URL);
      }
      config.baseURL = customUrl;

      const storedToken = await getAuthToken();
      if (storedToken && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${storedToken}`;
      }
    } catch (e) {
      console.warn('Error al leer configuración de almacenamiento', e);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor de respuesta con Reintento Automático (Failover) exclusivo entre endpoints del VPS
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest?.url?.includes('/auth/mobile-login')) {
      const authorization = originalRequest?.headers?.Authorization;
      notifySessionExpired(typeof authorization === 'string' ? authorization.replace(/^Bearer /i, '') : undefined);
    }
    // Si no hay respuesta del servidor (error de red o timeout) y no se ha reintentado
    if (!error.response && originalRequest && !originalRequest._retry
      && shouldRetryRequest(originalRequest.method, error.code, originalRequest.signal?.aborted)) {
      originalRequest._retry = true;
      try {
        const currentUrl = originalRequest.baseURL || api.defaults.baseURL || DEFAULT_API_URL;
        const alternateUrl = currentUrl === PRODUCTION_API_URL ? WWW_PRODUCTION_API_URL : PRODUCTION_API_URL;
        
        console.log(`[VPS Failover] Reintentando conexión con endpoint alternativo del VPS: ${alternateUrl}...`);
        api.defaults.baseURL = alternateUrl;
        await AsyncStorage.setItem('@custom_api_url', alternateUrl);

        originalRequest.baseURL = alternateUrl;
        return api(originalRequest);
      } catch (retryError) {
        return Promise.reject(retryError);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
