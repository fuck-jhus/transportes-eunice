import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import api from '../api/client';
import { createFleetConnection } from '../services/fleetConnection';
import { openTelemetrySocket } from '../services/openTelemetrySocket';
import { mergeFleetReading, type FleetBus } from '../utils/fleetTelemetry';

export const useFleetTelemetry = (enabled: boolean, userId?: number): FleetBus[] => {
  const [buses, setBuses] = useState<FleetBus[]>([]);
  useEffect(() => {
    setBuses([]);
    if (!enabled) return;
    let stopped = false;
    let syncing = false;
    let eventRevision = 0;
    const controller = new AbortController();
    const sync = async () => {
      if (stopped || syncing) return;
      syncing = true;
      const revision = eventRevision;
      try {
        const response = await api.get('/telemetria/activas', { signal: controller.signal });
        if (stopped || revision !== eventRevision || !Array.isArray(response.data)) return;
        setBuses(previous => response.data.reduce((all: FleetBus[], reading: any) => mergeFleetReading(all, reading), previous));
      } catch { /* Poll again; the socket can continue independently. */ }
      finally { syncing = false; }
    };
    const connection = createFleetConnection({
      sync: () => { void sync(); },
      open: openTelemetrySocket,
      onMessage: parsed => {
        const type = parsed.tipoMensaje || parsed.tipo;
        const data = parsed.data || parsed;
        if (type === 'telemetria') {
          eventRevision++;
          setBuses(previous => mergeFleetReading(previous, data));
        } else if (type === 'piloto_offline' || type === 'logout') {
          eventRevision++;
          setBuses(previous => mergeFleetReading(previous, { ...data, isOffline: true }));
        }
      },
    });
    const expiry = setInterval(() => setBuses(previous => previous.filter(bus => Date.now() - (bus.timestamp ?? 0) <= 30_000)), 5_000);
    const stateSubscription = AppState.addEventListener('change', state => { if (state === 'active') connection.resume(); });
    return () => {
      stopped = true;
      controller.abort();
      connection.stop();
      clearInterval(expiry);
      stateSubscription.remove();
    };
  }, [enabled, userId]);
  return buses;
};
