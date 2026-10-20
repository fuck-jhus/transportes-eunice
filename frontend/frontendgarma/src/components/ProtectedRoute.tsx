import type { ReactNode } from 'react';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { useAuth } from '../context/useAuth';

type Role = 'Piloto' | 'Administrador' | 'Supervisor' | 'SuperAdministrador';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: Role[];
}

export const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return (
      <main className="session-loader" aria-live="polite" aria-busy="true">
        <div className="session-loader-spinner" />
        <p>Verificando tu acceso…</p>
      </main>
    );
  }

  if (!isAuthenticated || !user) return null;

  const isAllowed = user.tipoRol === 'SuperAdministrador'
    || !allowedRoles
    || allowedRoles.includes(user.tipoRol);

  if (!isAllowed) {
    return (
      <main className="access-state">
        <div className="access-state-card">
          <span className="access-state-icon"><LockKeyhole size={24} /></span>
          <span className="eyebrow">Acceso limitado</span>
          <h1>Este módulo no está disponible para tu rol.</h1>
          <p>Tu cuenta está activa, pero necesita un permiso adicional para abrir esta sección.</p>
          <button type="button" onClick={() => window.history.back()}>
            <ArrowLeft size={18} /> Volver
          </button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
};
