import { createContext } from 'react';

export interface User {
  idUsuario: number;
  nombreCompleto: string;
  tipoRol: 'Piloto' | 'Administrador' | 'Supervisor' | 'SuperAdministrador';
  usuarioLogin: string;
  estado: string;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (usuarioLogin: string, contrasena: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
