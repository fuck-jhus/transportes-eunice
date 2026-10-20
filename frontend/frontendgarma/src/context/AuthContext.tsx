import React, { useState, useEffect, type ReactNode } from 'react';
import { isAxiosError } from 'axios';
import api from '../services/api';
import { AuthContext, type User } from './authContextValue';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Verifica si el usuario ya posee una sesión activa en el servidor al cargar la app
  const checkAuth = async () => {
    try {
      // El backend leerá la cookie HttpOnly "AuthToken" y validará el JWT
      const response = await api.get<User>('/auth/me');
      setUser(response.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    api
      .get<User>('/auth/me')
      .then((response) => {
        if (isMounted) setUser(response.data);
      })
      .catch(() => {
        if (isMounted) setUser(null);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => setUser(null);
    window.addEventListener('auth:expired', handleExpiredSession);
    return () => window.removeEventListener('auth:expired', handleExpiredSession);
  }, []);

  // Función de Login
  const login = async (usuarioLogin: string, contrasena: string) => {
    try {
      setLoading(true);
      const response = await api.post<User>('/auth/login', {
        usuarioLogin,
        contrasena,
      });
      setUser(response.data);
    } catch (error: unknown) {
      setUser(null);
      const message = isAxiosError<{ mensaje?: string }>(error)
        ? error.response?.data?.mensaje
        : undefined;
      throw new Error(message || 'Error al iniciar sesión.', { cause: error });
    } finally {
      setLoading(false);
    }
  };

  // Función de Logout
  const logout = async () => {
    try {
      setLoading(true);
      await api.post('/auth/logout');
      setUser(null);
    } catch (error: unknown) {
      const message = isAxiosError<{ mensaje?: string }>(error)
        ? error.response?.data?.mensaje
        : undefined;
      throw new Error(message || 'No se pudo cerrar la sesión. Intenta nuevamente.', { cause: error });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
