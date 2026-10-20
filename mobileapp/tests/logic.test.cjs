const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/navigation.cjs');
const { memoryStorage } = require('./helpers/reactHarness.cjs');
const esm = value => ({ __esModule: true, default: value });
const reading = () => ({ latitud: 15, longitud: -90, velocidadKmh: 20, fechaHoraDispositivo: new Date().toISOString() });

test('individual receipts preserve poison in quarantine while later valid readings drain', async () => {
  const storage = memoryStorage(); const received = [];
  const load = loader({ '@react-native-async-storage/async-storage': esm(storage), './tokenStorage': { getAuthToken: async () => 'fixture' },
    '../api/client': esm({ post: async (_url, batch) => { received.push(...batch); return { data: { lecturas: batch.map((item, index) => ({
      idLectura: item.idLectura, estado: received.length === 100 && index === 0 ? 'rechazada' : 'aceptada', codigo: 'FECHA_INVALIDA' })) } }; } }) });
  const queue = load('src/services/offlineStorage.ts'); const delivery = load('src/services/telemetryDelivery.ts');
  for (let i = 0; i < 101; i++) await queue.enqueueTelemetry(1, 7, reading());
  await delivery.flushPendingTelemetry(1); const result = await delivery.flushPendingTelemetry(1);
  assert.equal(result.remaining, 1); assert.equal(result.quarantined, 1);
  assert.equal(received.length, 101); assert.equal((await queue.readTelemetryQueue(1, 7))[0].rejection.code, 'FECHA_INVALIDA');
  const exported = JSON.parse(await queue.exportPendingTelemetry(1)); assert.equal(exported.trips[0].readings.length, 1);
});

test('unknown receipts never erase a pending observation', async () => {
  const storage = memoryStorage();
  const load = loader({ '@react-native-async-storage/async-storage': esm(storage), './tokenStorage': { getAuthToken: async () => 'fixture' },
    '../api/client': esm({ post: async () => ({ data: { lecturas: [{ idLectura: 'not-requested', estado: 'aceptada' }] } }) }) });
  const queue = load('src/services/offlineStorage.ts'); await queue.enqueueTelemetry(1, 7, reading());
  assert.equal((await load('src/services/telemetryDelivery.ts').flushPendingTelemetry(1)).remaining, 1);
});

test('arrival requires fresh accurate matched evidence; snooze cannot manufacture it', () => {
  const { arrivalEligible } = loader()('src/utils/arrivalEligibility.ts'); const now = Date.now();
  const good = { distanceMeters: 20, accuracy: 5, timestamp: now, matched: true, routeRemainingMeters: 30, now };
  assert.equal(arrivalEligible(good), true); assert.equal(arrivalEligible({ ...good, timestamp: now - 16_000 }), false);
  assert.equal(arrivalEligible({ ...good, accuracy: 100 }), false); assert.equal(arrivalEligible({ ...good, matched: false }), false);
});

test('navigation binding survives restore; personal destinations do not inherit an assigned journey', async () => {
  const storage = memoryStorage(); const { NavigationSessionStore } = loader()('src/services/navigationSessionStore.ts');
  const store = new NavigationSessionStore(storage, 1); await store.hydrate();
  const destination = { id: 'assigned', name: 'Terminal', address: 'Terminal', lat: 15, lng: -90, timestamp: Date.now() };
  store.setDestination(destination); store.bindTrip(7, 'version', 2); await store.flush();
  const restored = new NavigationSessionStore(storage, 1); await restored.hydrate(); assert.equal(restored.getSnapshot().assignedTripId, 7);
  assert.equal(restored.getSnapshot().assignedTripRevision, 2);
  restored.setDestination({ ...destination, id: 'personal', name: 'Casa' }); assert.equal(restored.getSnapshot().assignedTripId, null);
  assert.equal(restored.getSnapshot().assignedTripRevision, null);
  store.clear(); assert.equal(store.getSnapshot().assignedTripId, null); assert.equal(store.getSnapshot().assignedTripRevision, null);
  store.dispose(); restored.dispose();
});
