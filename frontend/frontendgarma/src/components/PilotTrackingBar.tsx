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

  const details = [
    activeTrip?.placaAutobus || 'Sin unidad',
    tracking.accuracy == null ? null : `±${tracking.accuracy} m`,
    tracking.queuedReadings > 0 ? `${tracking.queuedReadings} pendientes` : formatLastSent(tracking.lastSentAt),
  ].filter(Boolean).join(' · ');

  return (
    <section className={`ptb is-${tracking.phase}`} aria-live="polite">
      <span className="ptb-icon" aria-hidden="true"><Icon size={18} /></span>
      <div className="ptb-copy">
        <strong>{loading ? 'Verificando despacho…' : tracking.statusText}</strong>
        <small><BusFront size={12} aria-hidden="true" /> {details}</small>
      </div>
      <div className="ptb-actions">
        {tracking.sourceConflict && <button type="button" className="pill-button is-ghost is-small" onClick={() => void tracking.takeTrackingControl()}>Usar este GPS</button>}
        {tracking.queuedReadings > 0 && <button type="button" className="pill-button is-ghost is-small" onClick={tracking.exportPending}>Exportar pendientes</button>}
        {canRetry && (
          <button type="button" onClick={tracking.retry} className="pill-button is-ghost is-small">
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        )}
        {canPause && (
          <button type="button" onClick={() => void tracking.togglePaused()} className={`pill-button is-small${tracking.isPaused ? '' : ' is-ghost'}`}>
            {tracking.isPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
            {tracking.isPaused ? 'Reanudar' : 'Pausar'}
          </button>
        )}
      </div>
    </section>
  );
};
