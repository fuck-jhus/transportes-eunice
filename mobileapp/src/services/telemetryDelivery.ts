import api from '../api/client';
import { getAuthToken } from './tokenStorage';
import { pendingTripIds, readTelemetryQueue, removeTelemetryReadings, quarantineTelemetry, type QueuedTelemetry } from './offlineStorage';

const running = new Map<number, Promise<{ remaining: number; sent: boolean; quarantined: number }>>();
export const pendingTelemetryCount = async (userId: number) => {
  let count = 0;
  for (const tripId of await pendingTripIds(userId)) count += (await readTelemetryQueue(userId, tripId)).length;
  return count;
};
export const flushPendingTelemetry = (userId: number, enabled: () => boolean = () => true) => {
  const current = running.get(userId);
  if (current) return current;
  const task = (async () => {
    const token = await getAuthToken();
    if (!token || !enabled()) return { remaining: await pendingTelemetryCount(userId), sent: false, quarantined: 0 };
    const request = { headers: { Authorization: `Bearer ${token}`, 'X-Eunice-User': String(userId) } };
    let sent = false;
    const deliverLegacy = async (tripId: number, batch: QueuedTelemetry[]): Promise<void> => {
      if (!enabled()) return;
      try {
        await api.post('/telemetria/batch', batch.map(item => ({ ...item.payload, idViaje: tripId, idLectura: item.id })), request);
        await removeTelemetryReadings(userId, tripId, new Set(batch.map(x => x.id)));
        sent = true;
      } catch (error) {
        if ((error as { response?: { status?: number } }).response?.status !== 400) throw error;
        if (batch.length > 1) {
          const middle = Math.ceil(batch.length / 2);
          await deliverLegacy(tripId, batch.slice(0, middle));
          await deliverLegacy(tripId, batch.slice(middle));
        } else await quarantineTelemetry(userId, tripId, new Map([[batch[0].id, { code: 'REVISAR_LECTURA', message: 'Posición rechazada; se conserva para revisión.' }]]));
      }
    };
    for (const tripId of await pendingTripIds(userId)) {
      if (!enabled() || await getAuthToken() !== token || !enabled()) break;
      const batch = (await readTelemetryQueue(userId, tripId)).filter(x => !x.rejection).slice(0, 100);
      if (!batch.length) continue;
      // The server either accepts this trip-bound batch (including replays) or
      // rejects it. Never acknowledge a request that did not return success.
      try {
        const response = await api.post<{ lecturas: { idLectura: string; estado: string; codigo?: string; mensaje?: string }[] }>('/telemetria/delivery',
          batch.map(item => ({ ...item.payload, idViaje: tripId, idLectura: item.id })), request);
        if (!Array.isArray(response.data?.lecturas)) throw new Error('El servidor no confirmó las posiciones individualmente.');
        const requested = new Set(batch.map(x => x.id));
        const receipts = response.data.lecturas.filter(x => requested.has(x.idLectura));
        const confirmed = receipts.filter(x => x.estado === 'aceptada' || x.estado === 'duplicada');
        await quarantineTelemetry(userId, tripId, new Map(receipts.filter(x => x.estado === 'rechazada').map(x => [x.idLectura,
          { code: x.codigo ?? 'REVISAR_LECTURA', message: x.mensaje ?? 'Requiere revisión' }])));
        await removeTelemetryReadings(userId, tripId, new Set(confirmed.map(x => x.idLectura)));
        sent ||= confirmed.length > 0;
      } catch (error) {
        if ((error as { response?: { status?: number } }).response?.status !== 404) throw error;
        await deliverLegacy(tripId, batch);
      }
    }
    let remaining = 0;
    let quarantined = 0;
    for (const tripId of await pendingTripIds(userId)) {
      const queue = await readTelemetryQueue(userId, tripId);
      remaining += queue.length;
      quarantined += queue.filter(x => x.rejection).length;
    }
    return { remaining, sent, quarantined };
  })();
  running.set(userId, task);
  void task.finally(() => { if (running.get(userId) === task) running.delete(userId); }).catch(() => {});
  return task;
};
