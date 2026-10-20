const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText;
    const req = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name);
        return load(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx');
      }
      return require(name);
    };
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: req,
      setTimeout, clearTimeout, setInterval, clearInterval, Date, console, ...globals }, { filename: file });
    return mod.exports;
  }
  return load;
}
const nav = loader()('src/utils/navigationTelemetry.ts');
test('GPS local is independent of dispatch, transmission still requires a pilot and trip', () => {
  assert.equal(nav.canUseLocalGps('Piloto', false), true);
  assert.equal(nav.canPublishTelemetry('Piloto', undefined, false), false);
  assert.equal(nav.canPublishTelemetry('Piloto', 3, false), true);
  assert.equal(nav.canPublishTelemetry('Administrador', 3, false), false);
  assert.equal(nav.canPublishTelemetry('Piloto', 3, true), false);
});
test('missing heading is not north; zero degrees remains a valid course', () => {
  for (const value of [null, undefined, -1, 360, NaN, '90']) assert.equal(nav.validHeading(value), null);
  assert.equal(nav.validHeading(0), 0);
});
test('moving course beats phone compass and crosses north on the shortest arc', () => {
  const a = { lat: 14.8, lng: -91.5, timestamp: 1000, accuracy: 3 };
  const b = { ...a, lng: -91.4998, timestamp: 2000 };
  assert.equal(nav.resolveNavigationHeading(90, 40, a, b, 270, null), 90);
  assert.ok(Math.abs(nav.resolveNavigationHeading(null, 40, a, b, 270, null) - 90) < 0.1);
  assert.equal(nav.resolveNavigationHeading(null, 0, a, b, 270, 90), 270);
  assert.ok(nav.smoothHeading(359, 1) < 2);
  assert.equal(nav.headingDifference(1, 359), -2);
});
test('no fabricated course from jitter or a long gap', () => {
  const a = { lat: 14.8, lng: -91.5, timestamp: 1000, accuracy: 20 };
  assert.equal(nav.resolveNavigationHeading(-1, 20, a, { ...a, lng: -91.499999, timestamp: 2000 }, 0, null), null);
  assert.equal(nav.resolveNavigationHeading(-1, 20, a, { ...a, lng: -91.49, timestamp: 100000 }, 0, 45), 45);
});
const fleet = loader()('src/utils/fleetTelemetry.ts');
test('live map rejects stale/out-of-order frames and derives heading without gyro', () => {
  const now = Date.now();
  let buses = fleet.mergeFleetReading([], { placaAutobus: 'BUS-1', latitud: 14.8, longitud: -91.5,
    velocidadKmh: 40, giroscopioZ: 1.57, fechaHoraDispositivo: new Date(now).toISOString() }, now);
  assert.equal(buses[0].heading, null);
  buses = fleet.mergeFleetReading(buses, { placaAutobus: 'bus-1', latitud: 14.8, longitud: -91.4998,
    velocidadKmh: 40, fechaHoraDispositivo: new Date(now + 1000).toISOString() }, now + 1000);
  assert.ok(Math.abs(buses[0].heading - 90) < 0.1);
  assert.equal(fleet.mergeFleetReading(buses, { placaAutobus: 'BUS-1', latitud: 14, longitud: -90,
    fechaHoraDispositivo: new Date(now - 5000).toISOString() }, now + 1000), buses);
  assert.equal(fleet.mergeFleetReading([], { placaAutobus: 'OLD', latitud: 14, longitud: -90,
    fechaHoraDispositivo: new Date(now - 121000).toISOString() }, now).length, 0);
  assert.equal(fleet.mergeFleetReading(buses, { placaAutobus: 'BUS-1', isPrivacyMode: true }).length, 0);
});
function clock() {
  let now = 0, next = 0; const timers = new Map();
  const create = (fn, delay, repeat) => { const id = ++next; timers.set(id, { fn, delay, repeat, at: now + delay }); return id; };
  return { timers, now: () => now, globals: {
    setTimeout: (fn, ms) => create(fn, ms, false), setInterval: (fn, ms) => create(fn, ms, true),
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
  }, tick(ms) {
    const end = now + ms;
    while (true) {
      const pending = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending) break;
      const [id, timer] = pending; now = timer.at;
      if (timer.repeat) timer.at += timer.delay; else timers.delete(id);
      timer.fn();
    }
    now = end;
  } };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function socket() { return { readyState: 0, sent: [], closed: 0, send(data) { this.sent.push(JSON.parse(data)); }, close() { this.closed++; } }; }
test('socket heartbeat, fast uplink, fallback/backpressure, reconnect and cleanup', async () => {
  const time = clock(), sockets = []; let syncs = 0, frames = 0;
  const { createFleetConnection } = loader({}, time.globals)('src/services/fleetConnection.ts');
  const conn = createFleetConnection({ now: time.now, sync: () => syncs++,
    onMessage: () => frames++, open: async () => { const s = socket(); sockets.push(s); return s; } });
  await settle(); const first = sockets[0];
  assert.equal(conn.send({ tipo: 'telemetria' }), false);
  first.readyState = 1; first.onopen();
  assert.equal(first.sent[0].tipo, 'ping');
  assert.equal(conn.send({ tipo: 'telemetria', heading: 90 }), true);
  first.bufferedAmount = 65000; assert.equal(conn.send({ tipo: 'telemetria' }), false); first.bufferedAmount = 0;
  first.onmessage({ data: '{bad' }); first.onmessage({ data: '{"tipoMensaje":"pong"}' }); assert.equal(frames, 1);
  time.tick(20000); assert.ok(first.sent.filter(x => x.tipo === 'ping').length >= 2);
  first.onclose(); assert.equal(first.onclose, null);
  time.tick(1000); await settle(); assert.equal(sockets.length, 2);
  conn.resume(); await settle(); assert.equal(sockets.length, 3);
  conn.stop(); time.tick(120000); await settle(); assert.equal(sockets.length, 3);
  assert.equal(time.timers.size, 0); assert.equal(conn.send({}), false); assert.ok(syncs >= 3);
});
test('socket opening after unmount is closed and never resurrects', async () => {
  const time = clock(); let finish;
  const { createFleetConnection } = loader({}, time.globals)('src/services/fleetConnection.ts');
  const conn = createFleetConnection({ sync: () => {}, onMessage: () => {}, open: () => new Promise(r => finish = r) });
  conn.stop(); const late = socket(); finish(late); await settle();
  assert.equal(late.closed, 1); assert.equal(late.onopen, undefined); assert.equal(time.timers.size, 0);
});
test('simultaneous queue appends and HTTP acknowledgements cannot erase new GPS fixes', async () => {
  const storage = new Map();
  const memory = { getItem: async k => storage.get(k) ?? null, setItem: async (k, v) => storage.set(k, v), removeItem: async k => storage.delete(k) };
  const queue = loader({ '@react-native-async-storage/async-storage': { __esModule: true, default: memory } })('src/services/offlineStorage.ts');
  const payload = { latitud: 14.8, longitud: -91.5, velocidadKmh: 10, fechaHoraDispositivo: new Date().toISOString() };
  await Promise.all(Array.from({ length: 12 }, () => queue.enqueueTelemetry(1, 7, payload)));
  const before = await queue.readTelemetryQueue(1, 7); assert.equal(before.length, 12);
  await Promise.all([queue.removeTelemetryReadings(1, 7, new Set(before.slice(0, 5).map(x => x.id))), queue.enqueueTelemetry(1, 7, payload)]);
  assert.equal((await queue.readTelemetryQueue(1, 7)).length, 8);
  assert.equal((await queue.readTelemetryQueue(2, 7)).length, 0);
});
test('navigation map updates markers in place and follows without resetting zoom', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/LeafletNativeMap.tsx'), 'utf8');
  assert.match(source, /window\.__EUNICE_MAP_FOLLOW[\s\S]*?map\.panTo/);
  assert.match(source, /moveMarker\(userMarker/); assert.match(source, /moveMarker\(busMarker/);
  assert.doesNotMatch(source, /markerLayer\.clearLayers\(\)/);
  const hook = fs.readFileSync(path.join(root, 'src/hooks/useLiveTelemetryStreamer.ts'), 'utf8');
  assert.match(hook, /SEND_INTERVAL_MS = 1_000/);
  assert.match(hook, /liveConnectionRef\.current\?\.send/);
  assert.match(hook, /timeInterval: 1_000/);
});

test('embedded map actually interpolates position, reuses markers and unwraps rotation', () => {
  const { createLeafletDocument } = loader({
    react: { forwardRef: fn => fn }, 'react-native': { StyleSheet: { create: x => x } },
    'react-native-webview': {}, '../screens/leafletAssets': { LEAFLET_CSS: '', LEAFLET_JS: '' },
  })('src/components/LeafletNativeMap.tsx');
  const markers = [], frames = new Map(); let id = 0, now = 0, pans = 0, flies = 0;
  const layer = () => ({ addTo() { return this; }, clearLayers() {}, removeLayer() {} });
  const map = { zoomControl: { setPosition() {} }, dragging: { enable() {} }, touchZoom: { enable() {} }, doubleClickZoom: { enable() {} },
    scrollWheelZoom: { enable() {} }, on() {}, getContainer: () => ({ addEventListener() {} }),
    invalidateSize() {}, panTo() { pans++; }, flyTo() { flies++; } };
  const L = { Browser: { retina: false }, map: () => map, layerGroup: layer,
    tileLayer: () => ({ addTo() { return this; }, bringToBack() {} }), divIcon: x => x,
    polyline: () => ({ addTo() {} }), marker(point, options) {
      const marker = { position: point, options, addTo() { return this; }, setIcon(icon) { this.options.icon = icon; },
        getLatLng() { return { lat: this.position[0], lng: this.position[1] }; }, setLatLng(p) { this.position = p; },
        on() {}, bindPopup() {} }; markers.push(marker); return marker;
    } };
  const window = { addEventListener() {}, ReactNativeWebView: { postMessage() {} },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: key => frames.delete(key) };
  const document = { body: { className: '' } };
  const script = [...createLeafletDocument().matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInNewContext(script, { window, document, L, performance: { now: () => now }, setTimeout: fn => fn() });
  const update = (latitude, heading) => window.__EUNICE_MAP_UPDATE({ theme: 'light', routes: [], buses: [],
    userMarker: { latitude, longitude: -91.5, heading, navigating: true, title: 'GPS', description: '' } });
  update(14.8, 359); update(14.81, 1);
  assert.equal(markers.length, 1); assert.match(markers[0].options.icon.html, /rotate\(361deg\)/);
  const advance = time => { now = time; for (const [key, fn] of [...frames]) { frames.delete(key); fn(time); } };
  advance(450); assert.ok(Math.abs(markers[0].position[0] - 14.805) < 0.000001);
  update(14.81, 2); // Compass-only update does not restart an existing position animation.
  advance(900); assert.equal(markers[0].position[0], 14.81);
  window.__EUNICE_MAP_FOLLOW({ latitude: 14.81, longitude: -91.5 });
  assert.equal(pans, 1); assert.equal(flies, 0);
});
