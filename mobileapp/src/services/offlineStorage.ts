import AsyncStorage from '@react-native-async-storage/async-storage';
import { CrearTelemetriaDto } from '../types/telemetry';

const BUFFER_PREFIX = '@eunice_telemetry_queue';
const PAGE_SIZE = 250;
type QueueIndex = { version: 2; head: number; tail: number; count: number };

export interface QueuedTelemetry {
  rejection?: { code: string; message: string };
  id: string;
  userId: number;
  tripId: number;
  createdAt: number;
  payload: CrearTelemetriaDto;
}

const bufferKey = (userId: number, tripId: number) => `${BUFFER_PREFIX}_${userId}_${tripId}`;
const queueLocks = new Map<string, Promise<unknown>>();
const deletedUsers = new Set<number>();
const withQueueLock = <T>(key: string, action: () => Promise<T>): Promise<T> => {
  const previous = queueLocks.get(key) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(action);
  queueLocks.set(key, task);
  void task.finally(() => { if (queueLocks.get(key) === task) queueLocks.delete(key); }).catch(() => {});
  return task;
};

const isValidCoordinate = (latitude: number, longitude: number) => (
  Number.isFinite(latitude)
  && Number.isFinite(longitude)
  && latitude >= -90
  && latitude <= 90
  && longitude >= -180
  && longitude <= 180
  && !(latitude === 0 && longitude === 0)
);

const readQueueUnlocked = async (userId: number, tripId: number): Promise<QueuedTelemetry[]> => {
    const raw = await AsyncStorage.getItem(bufferKey(userId, tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedTelemetry[] | QueueIndex;
    const readings = Array.isArray(parsed) ? parsed : (await Promise.all(
      Array.from({ length: parsed.tail - parsed.head + 1 }, (_, i) =>
        AsyncStorage.getItem(`${bufferKey(userId, tripId)}:page:${parsed.head + i}`)
          .then(page => { if (!page) throw new Error('Falta una página de posiciones pendientes.'); return JSON.parse(page) as QueuedTelemetry[]; })),
    )).flat();
    if (!readings.every((item) => (
      item?.userId === userId
      && item?.tripId === tripId
      && isValidCoordinate(item.payload?.latitud, item.payload?.longitud)
    ))) throw new Error('La cola contiene posiciones que requieren recuperación.');
    return readings.map(item => ({ ...item, payload: { ...item.payload, idViaje: tripId } }));
};

const writeQueueUnlocked = async (
  userId: number,
  tripId: number,
  readings: QueuedTelemetry[],
): Promise<void> => {
  const key = bufferKey(userId, tripId);
  const oldRaw = await AsyncStorage.getItem(key);
  const old = oldRaw ? JSON.parse(oldRaw) : null;
  // Each write uses a new generation: interruption cannot replace the old index
  // with a partially written set of pages. Unreferenced pages can be cleaned later.
  if (readings.length === 0) {
    await AsyncStorage.removeItem(key);
    if (old?.version === 2) await Promise.all(Array.from({ length: old.tail - old.head + 1 }, (_, i) =>
      AsyncStorage.removeItem(`${key}:page:${old.head + i}`))).catch(() => {});
    return;
  }
  const first = !Array.isArray(old) && old?.version === 2 ? old.tail + 1 : 0;
  const pages = Math.ceil(readings.length / PAGE_SIZE);
  for (let page = 0; page < pages; page++) {
    await AsyncStorage.setItem(`${key}:page:${first + page}`, JSON.stringify(readings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)));
  }
  await AsyncStorage.setItem(key, JSON.stringify({ version: 2, head: first, tail: first + pages - 1, count: readings.length } satisfies QueueIndex));
  if (old?.version === 2) {
    await Promise.all(Array.from({ length: old.tail - old.head + 1 }, (_, i) => AsyncStorage.removeItem(`${key}:page:${old.head + i}`))).catch(() => {});
  }
};

export const readTelemetryQueue = (userId: number, tripId: number): Promise<QueuedTelemetry[]> =>
  withQueueLock(bufferKey(userId, tripId), () => readQueueUnlocked(userId, tripId));

export const writeTelemetryQueue = (userId: number, tripId: number, readings: QueuedTelemetry[]): Promise<void> =>
  withQueueLock(bufferKey(userId, tripId), () => writeQueueUnlocked(userId, tripId, readings));

export const removeTelemetryReadings = (userId: number, tripId: number, ids: Set<string>): Promise<number> =>
  withQueueLock(bufferKey(userId, tripId), async () => {
    const current = await readQueueUnlocked(userId, tripId);
    const remaining = current.filter(item => !ids.has(item.id));
    await writeQueueUnlocked(userId, tripId, remaining);
    return remaining.length;
  });

export const quarantineTelemetry = (userId: number, tripId: number, rejections: Map<string, { code: string; message: string }>) =>
  withQueueLock(bufferKey(userId, tripId), async () => {
    const current = await readQueueUnlocked(userId, tripId);
    await writeQueueUnlocked(userId, tripId, current.map(item => rejections.has(item.id) ? { ...item, rejection: rejections.get(item.id) } : item));
  });

export const exportPendingTelemetry = async (userId: number) => {
  const prefix = `${BUFFER_PREFIX}_${userId}_`;
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  const raw = Object.fromEntries(await Promise.all(keys.map(async key => [key, await AsyncStorage.getItem(key)])));
  let trips: { tripId: number; readings: QueuedTelemetry[] }[] = [];
  try { trips = await Promise.all((await pendingTripIds(userId)).map(async tripId => ({ tripId, readings: await readTelemetryQueue(userId, tripId) }))); }
  catch { /* Raw pages remain exportable even when an index requires recovery. */ }
  return JSON.stringify({ userId, format: 'eunice-recovery-v1', trips, raw }, null, 2);
};

export const enqueueTelemetry = (
  userId: number,
  tripId: number,
  payload: CrearTelemetriaDto,
): Promise<number> => withQueueLock(bufferKey(userId, tripId), async () => {
  if (deletedUsers.has(userId)) throw new Error('La cuenta fue eliminada.');
  const createdAt = Date.now();
  const item: QueuedTelemetry = {
    id: `${createdAt}-${Math.random().toString(36).slice(2)}`,
    userId,
    tripId,
    createdAt,
    payload: { ...payload, idViaje: tripId },
  };
  const key = bufferKey(userId, tripId);
  const raw = await AsyncStorage.getItem(key);
  const index: QueueIndex | QueuedTelemetry[] | null = raw ? JSON.parse(raw) : null;
  if (!index || Array.isArray(index)) {
    const next = [...(index ?? []), item];
    await writeQueueUnlocked(userId, tripId, next);
    return next.length;
  }
  const tailKey = `${key}:page:${index.tail}`;
  const tailRaw = await AsyncStorage.getItem(tailKey);
  if (!tailRaw) throw new Error('No se pudo recuperar la cola de posiciones.');
  const tail: QueuedTelemetry[] = JSON.parse(tailRaw);
  if (tail.length >= PAGE_SIZE) {
    index.tail++;
    await AsyncStorage.setItem(`${key}:page:${index.tail}`, JSON.stringify([item]));
  } else {
    await AsyncStorage.setItem(tailKey, JSON.stringify([...tail, item]));
  }
  index.count++;
  await AsyncStorage.setItem(key, JSON.stringify(index));
  return index.count;
});

export const pendingTripIds = async (userId: number): Promise<number[]> => {
  const prefix = `${BUFFER_PREFIX}_${userId}_`;
  return (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix) && !key.includes(':page:'))
    .map(key => Number(key.slice(prefix.length))).filter(id => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
};

export const purgeDeletedUserTelemetry = async (userId: number) => {
  deletedUsers.add(userId);
  const prefix = `${BUFFER_PREFIX}_${userId}_`;
  await Promise.allSettled([...queueLocks.entries()].filter(([key]) => key.startsWith(prefix)).map(([, task]) => task));
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter(key => key.startsWith(prefix)));
};
