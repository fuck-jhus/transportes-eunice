import { useEffect, useRef } from 'react';
import { BarChart3, Bus, ClipboardList, LogOut, MapPinned, MessageSquare, Navigation, Users } from 'lucide-react';
import { getDashboardStyles } from '../styles/dashboardStyles';
import type { DashboardTab, ManagedUser } from '../types/dashboard';

interface DashboardSidebarProps {
  activeTab: DashboardTab;
  isDark: boolean;
  role?: ManagedUser['tipoRol'];
  onTabChange: (tab: DashboardTab) => void;
  onLogout: () => void;
}

export const DashboardSidebar = ({
  activeTab,
  isDark,
  role,
  onTabChange,
  onLogout,
}: DashboardSidebarProps) => {
  const styles = getDashboardStyles(isDark);
  const navRef = useRef<HTMLElement>(null);
  const canDispatch = role === 'Administrador' || role === 'SuperAdministrador' || role === 'Supervisor';
  const canManageUsers = role === 'Administrador' || role === 'SuperAdministrador';
  const navStyle = (tab: DashboardTab) => activeTab === tab ? styles.sidebarNavActiveStyle : styles.sidebarNavInactiveStyle;

  useEffect(() => {
    const activeItem = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!activeItem) return;
    activeItem.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [activeTab]);

  return (
    <aside className="app-sidebar" style={styles.sidebarContainerStyle}>
      <div>
        <div className="sidebar-brand" style={styles.sidebarBrandStyle}>
          <div style={styles.sidebarLogoBadgeStyle}><Bus size={22} strokeWidth={2.2} /></div>
          <div>
            <div style={styles.sidebarBrandTitleStyle}>Eunice</div>
            <div style={styles.sidebarBrandSubtitleStyle}>Transportes y Agencia de Viajes</div>
          </div>
        </div>

        <nav ref={navRef} className="sidebar-nav" style={styles.sidebarNavListStyle} aria-label="Navegación principal">
          <button type="button" onClick={() => onTabChange('map')} data-active={activeTab === 'map' || activeTab === 'telemetry'}
            aria-current={(activeTab === 'map' || activeTab === 'telemetry') ? 'page' : undefined}
            style={(activeTab === 'map' || activeTab === 'telemetry') ? styles.sidebarNavActiveStyle : styles.sidebarNavInactiveStyle}>
            <Navigation size={18} /><span>Monitoreo GPS</span>
          </button>

          {canDispatch && (
            <button type="button" onClick={() => onTabChange('alerts')} data-active={activeTab === 'alerts'}
              aria-current={activeTab === 'alerts' ? 'page' : undefined} style={navStyle('alerts')}>
              <BarChart3 size={18} /><span>Alertas y Telemetría</span>
            </button>
          )}

          <button type="button" onClick={() => onTabChange('activity')} data-active={activeTab === 'activity'}
            aria-current={activeTab === 'activity' ? 'page' : undefined} style={navStyle('activity')}>
            <ClipboardList size={18} /><span>Historial de Viajes</span>
          </button>

          {canDispatch && (
            <button type="button" onClick={() => onTabChange('buses')} data-active={activeTab === 'buses'}
              aria-current={activeTab === 'buses' ? 'page' : undefined} style={navStyle('buses')}>
              <Bus size={18} /><span>Autobuses</span>
            </button>
          )}

          {canDispatch && (
            <button type="button" onClick={() => onTabChange('routes')} data-active={activeTab === 'routes'}
              aria-current={activeTab === 'routes' ? 'page' : undefined} style={navStyle('routes')}>
              <MapPinned size={18} /><span>Rutas guardadas</span>
            </button>
          )}

          {canManageUsers && (
            <button type="button" onClick={() => onTabChange('users')} data-active={activeTab === 'users'}
              aria-current={activeTab === 'users' ? 'page' : undefined} style={navStyle('users')}>
              <Users size={18} /><span>Personal</span>
            </button>
          )}

          <button type="button" onClick={() => onTabChange('chat')} data-active={activeTab === 'chat'}
            aria-current={activeTab === 'chat' ? 'page' : undefined} style={navStyle('chat')}>
            <MessageSquare size={18} /><span>Chat Operativo</span>
          </button>
        </nav>
      </div>

      <div className="sidebar-actions" style={{
        paddingTop: '16px', borderTop: '1px solid var(--nav-line)',
        display: 'flex', flexDirection: 'column', gap: '8px'
      }}>
        <button type="button" onClick={onLogout} style={styles.sidebarLogoutButtonStyle}>
          <LogOut size={18} /><span>Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  );
};
