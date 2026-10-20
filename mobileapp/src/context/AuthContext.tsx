import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { DEFAULT_API_URL, VALID_VPS_URLS } from '../api/client';
import { UserSession } from '../types/telemetry';
import { clearAuthToken, getAuthToken, setAuthToken } from '../services/tokenStorage';
import { unregisterPushNotificationsAsync } from '../services/pushNotifications';
import { onSessionExpired } from '../services/authEvents';
import { stopBackgroundTracking } from '../services/backgroundTelemetry';
import { clearUserPlaces, retireLegacyPlaces } from '../services/userPlaces';
import { purgeDeletedUserTelemetry } from '../services/offlineStorage';
import { useToast } from './ToastContext';

interface AuthContextType {
  user: UserSession | null;
  loading: boolean;
  login: (usuarioLogin: string, contrasena: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (contrasena: string) => Promise<void>;
  apiUrl: string;
  setApiUrl: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

const isJwtExpired = (token: string): boolean => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = typeof atob === 'function' ? atob(normalized) : '';
    if (!decoded) return false;
    const payload = JSON.parse(decoded);
    if (!payload.exp) return false;
    return (payload.exp * 1000) <= (Date.now() + 30000);
  } catch {
    return false;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const expiring = useRef(false);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [apiUrl, setApiUrlState] = useState<string>(DEFAULT_API_URL);

  useEffect(() => {
    const expire = async (rejectedToken?: string) => {
      const current = await getAuthToken();
      if (!current || (rejectedToken && current !== rejectedToken) || expiring.current) return;
      expiring.current = true;
      setUser(null);
      try {
        await stopBackgroundTracking().catch(() => {});
        await Promise.all([unregisterPushNotificationsAsync(current).catch(() => {}), clearAuthToken(), AsyncStorage.removeItem('@user_session')]);
        showToast('Inicia sesión otra vez. Las posiciones pendientes se conservan en este dispositivo.', 'info', 'Sesión vencida');
      } finally { expiring.current = false; }
    };
    const unsubscribe = onSessionExpired(token => { void expire(token).catch(() => {}); });
    const check = async () => {
      const token = await getAuthToken();
      if (token && isJwtExpired(token)) await expire(token);
    };
    const timer = setInterval(() => { void check().catch(() => {}); }, 15_000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void check().catch(() => {}); });
    return () => { unsubscribe(); clearInterval(timer); sub.remove(); };
  }, [showToast]);

  useEffect(() => {
    loadInitialState();
  }, []);

  const loadInitialState = async () => {
    try {
      await retireLegacyPlaces();
      let storedUrl = await AsyncStorage.getItem('@custom_api_url');
      if (!storedUrl || !VALID_VPS_URLS.includes(storedUrl)) {
        storedUrl = DEFAULT_API_URL;
        await AsyncStorage.setItem('@custom_api_url', DEFAULT_API_URL);
      }
      setApiUrlState(storedUrl);
      api.defaults.baseURL = storedUrl;

      const storedToken = await getAuthToken();
      const storedUser = await AsyncStorage.getItem('@user_session');

      if (storedToken && storedUser) {
        if (isJwtExpired(storedToken)) {
          console.log('[Auth] Token JWT expirado en memoria local, limpiando sesión');
          await Promise.all([clearAuthToken(), AsyncStorage.removeItem('@user_session')]);
          setUser(null);
        } else {
          try {
            // Validar activamente vigencia del token contra el backend
            const meRes = await api.get('/auth/me', {
              headers: { Authorization: `Bearer ${storedToken}` },
              timeout: 4000
            });
            if (await getAuthToken() !== storedToken || isJwtExpired(storedToken)) return;
            if (meRes.status === 200) {
              const currentUser = meRes.data as UserSession;
              setUser(currentUser);
              await AsyncStorage.setItem('@user_session', JSON.stringify(currentUser));
            } else {
              await Promise.all([clearAuthToken(), AsyncStorage.removeItem('@user_session')]);
              setUser(null);
            }
          } catch (authErr: any) {
            if (authErr.response && authErr.response.status === 401) {
              console.log('[Auth] Token expirado o inválido, solicitando nuevo inicio de sesión');
              await Promise.all([clearAuthToken(), AsyncStorage.removeItem('@user_session')]);
              setUser(null);
            } else {
              // Error de red temporal: permitir uso offline si hay sesión previa y no está expirado
              if (await getAuthToken() === storedToken && !isJwtExpired(storedToken)) setUser(JSON.parse(storedUser));
            }
          }
        }
      } else {
        setUser(null);
      }
    } catch (e) {
      console.warn('Error cargando estado inicial', e);
    } finally {
      setLoading(false);
    }
  };

  const login = async (usuarioLogin: string, contrasena: string) => {
    const targetUrl = apiUrl || DEFAULT_API_URL;
    api.defaults.baseURL = targetUrl;

    try {
      const response = await api.post('/auth/mobile-login', { usuarioLogin, contrasena });
      const userData: UserSession = response.data.usuario;
      const token = response.data.token as string | undefined;

      if (!token) {
        throw new Error('El servidor no devolvió una sesión móvil válida.');
      }

      await Promise.all([
        AsyncStorage.setItem('@user_session', JSON.stringify(userData)),
        setAuthToken(token),
      ]);
      setUser(userData);
    } catch (error: any) {
      throw error;
    }
  };

  const logout = async () => {
    setLoading(true);
    setUser(null);
    try {
      const token = await getAuthToken();
      await Promise.all([
        stopBackgroundTracking().catch(() => {}),
        unregisterPushNotificationsAsync(token).catch(() => {}),
        token ? api.post('/auth/logout', undefined, { timeout: 1_500, headers: { Authorization: `Bearer ${token}` } }).catch(() => {}) : Promise.resolve(),
        AsyncStorage.removeItem('@user_session'),
        clearAuthToken(),
      ]);
    } catch (e) {
      console.warn('Error al desloguear', e);
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async (contrasena: string) => {
    if (!user) throw new Error('No hay una sesión activa.');

    await api.delete('/auth/cuenta', { data: { contrasena } });
    setLoading(true);
    setUser(null);
    try {
      await stopBackgroundTracking().catch(() => {});
      await purgeDeletedUserTelemetry(user.idUsuario);
      await clearUserPlaces(user.idUsuario);
      await Promise.all([
        AsyncStorage.removeItem('@user_session'), unregisterPushNotificationsAsync(null).catch(() => {}), clearAuthToken(),
      ]);
    } finally { setLoading(false); }
  };

  const setApiUrl = async (newUrl: string) => {
    setApiUrlState(newUrl);
    api.defaults.baseURL = newUrl;
    await AsyncStorage.setItem('@custom_api_url', newUrl);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, deleteAccount, apiUrl, setApiUrl }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
