import axios from 'axios';

export const API_PATH_PREFIX = '/api';

const normalizeApiBaseUrl = (value: string) => {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) return API_PATH_PREFIX;
  return normalized.toLowerCase().endsWith(API_PATH_PREFIX)
    ? normalized
    : `${normalized}${API_PATH_PREFIX}`;
};

// URL base del API Backend:
// 1. Si existe VITE_API_URL en variables de entorno, la usa prioritariamente.
// 2. Si está en producción (build para VPS/Nginx), usa '/api' relativo al dominio.
// 3. En desarrollo local, apunta a 'http://localhost:5059/api'.
export const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_URL || API_PATH_PREFIX,
);

export const buildWebSocketUrl = (apiBaseUrl = API_BASE_URL) => {
  const normalizedApiUrl = normalizeApiBaseUrl(apiBaseUrl);
  const apiOrigin = normalizedApiUrl.slice(0, -API_PATH_PREFIX.length);
  const httpOrigin = !apiOrigin || apiOrigin.startsWith('/')
    ? `${window.location.protocol}//${window.location.host}${apiOrigin}`
    : apiOrigin;

  return `${httpOrigin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')}/ws`;
};

/**
 * Cliente HTTP personalizado usando Axios.
 * Configura globalmente 'withCredentials: true' para que el navegador
 * almacene y envíe automáticamente la cookie HttpOnly en cada petición.
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
  withCredentials: true, // CLAVE: Permite enviar y recibir cookies HttpOnly
});

// Interceptor de respuesta para manejo global de errores
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401 && !window.location.pathname.startsWith('/viaje/')) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(error);
  }
);

export default api;
