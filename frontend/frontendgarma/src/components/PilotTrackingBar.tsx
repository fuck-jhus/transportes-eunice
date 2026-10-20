import { BusFront, LocateFixed, MapPinOff, Pause, Play, RefreshCw, Signal, WifiOff } from 'lucide-react';
import type { Viaje } from '../types/dashboard';
import type { PilotTrackingSnapshot } from '../hooks/usePilotTelemetry';

interface PilotTrackingBarProps {
  activeTrip: Viaje | null;
  loading: boolean;
  tracking: PilotTrackingSnapshot;
}

const formatLastSent = (timestamp: number | null) => {
  if (!timestamp) return 'Aún sin envíos';
  return `Enviado ${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

export const PilotTrackingBar = ({ activeTrip, loading, tracking }: PilotTrackingBarProps) => {
  const Icon = tracking.phase === 'offline'
    ? WifiOff
    : tracking.phase === 'paused'
      ? MapPinOff
      : tracking.phase === 'tracking'
        ? Signal
        : LocateFixed;
  const canPause = Boolean(activeTrip) && tracking.phase !== 'blocked';
  const canRetry = Boolean(activeTrip) && (tracking.phase === 'blocked' || tracking.phase === 'error' || tracking.phase === 'weak');

  return (
    <section className={`pilot-tracking-bar is-${tracking.phase}`} aria-live="polite">
      <div className="pilot-tracking-icon" aria-hidden="true"><Icon size={20} /></div>
      <div className="pilot-tracking-copy">
        <span>Rastreo desde este teléfono</span>
        <strong>{loading ? 'Verificando despacho' : tracking.statusText}</strong>
        <small>Mantén el sistema abierto durante el recorrido para conservar la señal.</small>
      </div>
      <div className="pilot-tracking-metrics" aria-label="Estado de transmisión">
        <div><BusFront size={14} /><span>{activeTrip?.placaAutobus || 'Sin unidad'}</span></div>
        <div><LocateFixed size={14} /><span>{tracking.accuracy == null ? 'Sin precisión' : `${tracking.accuracy} m`}</span></div>
        <div><Signal size={14} /><span>{tracking.queuedReadings > 0 ? `${tracking.queuedReadings} pendientes` : formatLastSent(tracking.lastSentAt)}</span></div>
      </div>
      <div className="pilot-tracking-actions">
        {tracking.sourceConflict && <button type="button" className="pilot-tracking-secondary" onClick={() => void tracking.takeTrackingControl()}>Usar este GPS</button>}
        {tracking.queuedReadings > 0 && <button type="button" className="pilot-tracking-secondary" onClick={tracking.exportPending}>Exportar pendientes</button>}
        {canRetry && (
          <button type="button" onClick={tracking.retry} className="pilot-tracking-secondary">
            <RefreshCw size={15} /> Reintentar
          </button>
        )}
        {canPause && (
          <button type="button" onClick={() => void tracking.togglePaused()} className="pilot-tracking-primary">
            {tracking.isPaused ? <Play size={15} /> : <Pause size={15} />}
            {tracking.isPaused ? 'Reanudar' : 'Pausar ubicación'}
          </button>
        )}
      </div>
    </section>
  );
};
