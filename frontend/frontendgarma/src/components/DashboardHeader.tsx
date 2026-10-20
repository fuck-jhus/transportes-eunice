import { Moon, Sun } from 'lucide-react';
import { getDashboardStyles } from '../styles/dashboardStyles';
import type { DashboardTab, ManagedUser } from '../types/dashboard';

interface DashboardHeaderProps {
  activeTab: DashboardTab;
  isDark: boolean;
  user?: Pick<ManagedUser, 'nombreCompleto' | 'tipoRol'> | null;
  onToggleTheme: () => void;
}

const TITLES: Record<DashboardTab, string> = {
  map: 'Monitoreo de Unidades en Vivo',
  telemetry: 'Monitoreo de Unidades en Vivo',
  alerts: 'Alertas y Reportes de Telemetría',
  activity: 'Historial de Recorridos y Despachos',
  buses: 'Flota de Autobuses',
  users: 'Gestión de Personal y Pilotos',
  chat: 'Centro de Comunicación y Radio',
  routes: 'Gestión de Rutas',
  trips: 'Planificación de Viajes',
};

const SUBTITLES: Record<DashboardTab, string> = {
  map: 'Posición, recorrido y disponibilidad de la flota en tiempo real.',
  telemetry: 'Posición, recorrido y disponibilidad de la flota en tiempo real.',
  alerts: 'Prioriza incidentes y detecta patrones antes de que escalen.',
  activity: 'Consulta despachos, recorridos y resultados operativos.',
  buses: 'Administra capacidad, asignaciones y estado de cada unidad.',
  users: 'Controla perfiles, accesos y responsabilidades del equipo.',
  chat: 'Coordina decisiones con pilotos y despacho desde un solo canal.',
  routes: 'Organiza los trayectos oficiales de la operación.',
  trips: 'Planifica salidas, asignaciones y cierres de viaje.',
};

export const DashboardHeader = ({ activeTab, isDark, user, onToggleTheme }: DashboardHeaderProps) => {
  const styles = getDashboardStyles(isDark);
  return (
    <header className="top-header" style={styles.topHeaderBarStyle}>
      <div className="page-heading">
        <span className="page-context">Centro de control / {activeTab === 'map' || activeTab === 'telemetry' ? 'En vivo' : TITLES[activeTab]}</span>
        <h1 style={styles.topHeaderTitleStyle}>{TITLES[activeTab]}</h1>
        <p style={styles.topHeaderSubtitleStyle}>{SUBTITLES[activeTab]}</p>
      </div>
      <div className="header-actions" style={styles.topHeaderRightStyle}>
        <button className="theme-toggle" type="button" onClick={onToggleTheme} title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} style={{
          display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--surface)',
          border: '1px solid var(--line)', borderRadius: '11px', padding: '8px 13px',
          color: 'var(--ink)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
          boxShadow: 'none'
        }}>
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
          <span>{isDark ? 'Modo Claro' : 'Modo Oscuro'}</span>
        </button>
        <div className="user-profile-chip" style={styles.userProfileChipStyle}>
          <div style={styles.userAvatarInitialsStyle}>{user?.nombreCompleto?.charAt(0) || 'U'}</div>
          <div className="user-profile-copy" style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={styles.userProfileNameStyle}>{user?.nombreCompleto}</span>
            <span style={styles.userProfileRoleStyle}>{user?.tipoRol}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
