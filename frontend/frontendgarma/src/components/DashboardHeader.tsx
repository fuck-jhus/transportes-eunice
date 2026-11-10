import { getDashboardStyles } from '../styles/dashboardStyles';
import type { DashboardTab } from '../types/dashboard';

interface DashboardHeaderProps {
  activeTab: DashboardTab;
  isDark: boolean;
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

export const DashboardHeader = ({ activeTab, isDark }: DashboardHeaderProps) => {
  const styles = getDashboardStyles(isDark);
  return (
    <header className="top-header page-header" style={styles.topHeaderBarStyle}>
      <div className="page-heading">
        <h1 style={styles.topHeaderTitleStyle}>{TITLES[activeTab]}</h1>
        <p style={styles.topHeaderSubtitleStyle}>{SUBTITLES[activeTab]}</p>
      </div>
    </header>
  );
};
