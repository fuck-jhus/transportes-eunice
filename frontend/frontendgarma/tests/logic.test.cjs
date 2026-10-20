const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('../../../mobileapp/tests/helpers/navigation.cjs');
const { reactHarness, settle } = require('../../../mobileapp/tests/helpers/reactHarness.cjs');
const esm = value => ({ __esModule: true, default: value });
function fixture({ corrupt = false, deny = false } = {}) {
  const harness = reactHarness(), data = new Map(), posts = [], notices = [];
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key),
    key: index => [...data.keys()][index], get length() { return data.size; } };
  const old = { id: 'old', userId: 1, tripId: 7, createdAt: Date.now() - 3 * 86400000,
    payload: { latitud: 15, longitud: -90, velocidadKmh: 20, fechaHoraDispositivo: new Date(Date.now() - 3 * 86400000).toISOString() } };
  storage.setItem('eunice_telemetry_queue_1_7', corrupt ? 'broken-json' : JSON.stringify([old]));
  const browser = { isSecureContext: true, location: { hostname: 'localhost' }, addEventListener() {}, removeEventListener() {},
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout };
  const load = loader({ react: harness.React, axios: { isAxiosError: value => Boolean(value?.response) },
    '../services/api': esm({ post: async (url, batch) => { posts.push({ url, batch });
      if (deny) throw { response: { status: 401 } };
      return { data: { lecturas: Array.isArray(batch) ? batch.map(x => ({ idLectura: x.idLectura, estado: 'aceptada' })) : [] } }; } }),
    '../utils/mapSupport': { hasValidCoordinates: (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng), getDistanceKm: () => 0 },
  }, { localStorage: storage, navigator: { onLine: true, geolocation: { watchPosition: () => 1, clearWatch() {} },
      locks: { request: async (_key, fn) => fn() } }, window: browser, crypto: require('node:crypto').webcrypto, queueMicrotask });
  const { usePilotTelemetry } = load(path.resolve(__dirname, '../src/hooks/usePilotTelemetry.ts'));
  const options = { enabled: true, userId: 1, activeTrip: { idViaje: 20 }, activeTripLoading: false, navigation: null,
    onTripInvalidated() {}, onNotify: message => notices.push(message) };
  const render = () => harness.render(() => usePilotTelemetry(options));
  return { harness, render, storage, posts, notices, options };
}
test('web retains and synchronizes an archived journey after the active assignment changes', async () => {
  const f = fixture(); f.render(); await new Promise(resolve => setTimeout(resolve, 5)); await settle(); f.render(); await settle();
  const request = f.posts.find(x => x.url === '/telemetria/delivery');
  assert.ok(request); assert.equal(request.batch[0].idViaje, 7); assert.equal(request.batch[0].idLectura, 'old');
  assert.equal(f.storage.getItem('eunice_telemetry_queue_1_7'), null); f.harness.dispose();
});
test('web preserves unreadable archives and rejected sessions instead of silently discarding them', async () => {
  const f = fixture({ corrupt: true }); f.render(); await new Promise(resolve => setTimeout(resolve, 5)); await settle(); f.render();
  assert.equal(f.storage.getItem('eunice_telemetry_queue_1_7'), 'broken-json'); assert.ok(f.notices.length > 0); f.harness.dispose();
  const denied = fixture({ deny: true }); denied.render(); await new Promise(resolve => setTimeout(resolve, 5)); await settle(); denied.render();
  assert.ok(denied.storage.getItem('eunice_telemetry_queue_1_7')); denied.harness.dispose();
});

test('web destination commands retain the revision selected by the user, not a newer dispatch revision', async () => {
  const f = fixture();
  f.options.activeTrip = { idViaje: 20, revisionDestino: 3 };
  f.options.navigation = { lat: 16, lng: -91, name: 'Destino elegido', tripId: 20, revision: 2 };
  f.render(); await new Promise(resolve => setTimeout(resolve, 5)); await settle();
  const command = f.posts.find(x => x.url === '/viajes/20/destino');
  assert.ok(command); assert.equal(command.batch.revision, 2);
  // An old guide must not become the destination of the replacement assignment.
  f.options.activeTrip = { idViaje: 21, revisionDestino: 0 }; f.render();
  await new Promise(resolve => setTimeout(resolve, 5)); await settle();
  assert.equal(f.posts.some(x => x.url === '/viajes/21/destino'), false);
  f.harness.dispose();
});
