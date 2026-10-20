const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loader, embeddedMap, root } = require('./helpers/navigation.cjs');
const load = loader();
const progress = load('src/utils/routeProgress.ts');
const { NavigationSessionStore, decodeNavigationSession } = load('src/services/navigationSessionStore.ts');
const { RouteCalculationController } = load('src/services/routeCalculationController.ts');
const destination = { id: 'one', name: 'Destino', address: 'Dirección', lat: 14, lng: -90.99, timestamp: Date.now() };
const coords = [[14, -91], [14, -90.99]];
const route = { id: 0, coords, distKm: 1.08, durationMin: 3 };
const fix = (patch = {}) => ({ lat: 14, lng: -90.9999, accuracy: 5, speedKmh: 30, heading: 90, timestamp: Date.now(), ...patch });
const json = value => JSON.parse(JSON.stringify(value));
function storage() {
  const data = new Map();
  return { data, getItem: async k => data.get(k) ?? null, setItem: async (k, v) => data.set(k, v), removeItem: async k => data.delete(k) };
}
async function session(memory = storage(), id = 7) {
  const store = new NavigationSessionStore(memory, id); await store.hydrate();
  store.setDestination(destination); store.finishCalculation([route]); store.setTripActive(true);
  return { store, memory };
}

test('parallel future street cannot steal progress or remove the original leg', () => {
  const loop = [[14, -91], [14, -90.999], [14.001, -90.999], [14.001, -91], [14.00002, -91], [14.00002, -90.999]];
  const geometry = progress.prepareRoute(loop);
  const first = progress.advanceRouteProgress(geometry, fix({ lat: 14.000018 }), progress.emptyProgress());
  assert.equal(first.segmentIndex, 0); assert.equal(first.matched, true);
  const second = progress.advanceRouteProgress(geometry, fix({ lng: -90.99985, timestamp: first.timestamp + 1000 }), first);
  assert.equal(second.segmentIndex, 0); assert.ok(second.distanceMeters >= first.distanceMeters);
});
test('off-route and poor-precision GPS never draw a connector across buildings', () => {
  const geometry = progress.prepareRoute(coords);
  let state = progress.advanceRouteProgress(geometry, fix(), progress.emptyProgress());
  const previousDistance = state.distanceMeters;
  for (let i = 1; i <= 3; i++) state = progress.advanceRouteProgress(geometry, fix({ lat: 14.002, timestamp: state.timestamp + 1000 }), state);
  assert.equal(state.offRouteCount, 3); assert.equal(state.matched, false); assert.equal(state.distanceMeters, previousDistance);
  assert.equal(progress.remainingRoute(geometry, state.distanceMeters)[0].latitude, 14);
  state = progress.advanceRouteProgress(geometry, fix({ accuracy: 80, timestamp: state.timestamp + 1000 }), state);
  assert.equal(state.matched, false); assert.equal(state.offRouteCount, 0);
});
test('late, malformed, backward-course and physically implausible jumps are not consumed', () => {
  const geometry = progress.prepareRoute(coords);
  const first = progress.advanceRouteProgress(geometry, fix(), progress.emptyProgress());
  assert.equal(progress.advanceRouteProgress(geometry, fix({ timestamp: first.timestamp }), first), first);
  assert.equal(progress.advanceRouteProgress(geometry, fix({ accuracy: NaN }), first), first);
  assert.equal(progress.advanceRouteProgress(geometry, fix({ lat: 100 }), first), first);
  for (const patch of [{ heading: 270 }, { lng: -90.995 }]) {
    const next = progress.advanceRouteProgress(geometry, fix({ ...patch, timestamp: first.timestamp + 1000 }), first);
    assert.equal(next.matched, false); assert.equal(next.distanceMeters, first.distanceMeters);
  }
});
test('parked jitter holds position; cosmetic filter does not modify the raw reading', () => {
  const geometry = progress.prepareRoute(coords);
  const first = progress.advanceRouteProgress(geometry, fix({ speedKmh: 0 }), progress.emptyProgress());
  const parked = progress.advanceRouteProgress(geometry, fix({ speedKmh: 0, lng: -90.99989, timestamp: first.timestamp + 1000 }), first);
  assert.equal(parked.distanceMeters, first.distanceMeters);
  const raw = fix({ speedKmh: 0, lng: -90.999895, timestamp: first.timestamp + 1000 });
  const filtered = progress.estimateGpsPosition(fix({ speedKmh: 0, timestamp: first.timestamp }), raw);
  assert.equal(raw.lng, -90.999895); assert.equal(filtered.lng, -90.9999);
  const jump = progress.estimateGpsPosition(filtered, fix({ lng: -90.5, timestamp: raw.timestamp + 1000 }));
  assert.equal(jump.lng, filtered.lng);
});
test('manoeuvres and remaining totals use route progress, not proximity to the first turn', () => {
  const r = { ...route, steps: [
    { type: 'depart', distance: 200, instruction: 'Salida' },
    { type: 'turn', distance: 300, instruction: 'Derecha' },
    { type: 'turn', distance: 500, instruction: 'Izquierda' },
    { type: 'arrive', distance: 0, instruction: 'Llegada' }] };
  assert.equal(progress.nextRouteStep(r, 210).instruction, 'Izquierda');
  assert.equal(progress.nextRouteStep(r, 600).instruction, 'Llegada');
  const g = progress.prepareRoute(coords);
  assert.equal(progress.remainingRouteInfo(route, g, g.total).distanceKm, 0);
  assert.ok(progress.remainingRouteInfo(route, g, g.total / 2).durationMin < route.durationMin);
});
test('session, route, progress, camera and manual-follow setting survive a screen or process recreation', async () => {
  const { store, memory } = await session();
  store.updateFix(fix()); store.setFollowUser(false);
  store.setCamera({ latitude: 14, longitude: -91, latitudeDelta: .012, longitudeDelta: .012 });
  await store.flush(); store.dispose();
  const restored = new NavigationSessionStore(memory, 7); await restored.hydrate();
  const state = restored.getSnapshot();
  assert.equal(state.destination.id, destination.id); assert.equal(state.tripActive, true);
  assert.equal(state.routes.length, 1); assert.ok(state.progress.distanceMeters > 0);
  assert.equal(state.progress.matched, false); // Require a fresh GPS fix before snapping again.
  assert.equal(state.followUser, false); assert.equal(state.camera.latitudeDelta, .012);
  restored.updateFix(fix({ lng: -90.9998, timestamp: state.progress.timestamp + 1000 }));
  assert.ok(restored.getSnapshot().progress.distanceMeters >= state.progress.distanceMeters);
  await restored.clear(); restored.dispose(); assert.equal(memory.data.size, 0);
});
test('stored route is isolated per user and rejects expired, oversized or invalid data', async () => {
  const { store, memory } = await session(); await store.flush(); store.dispose();
  const raw = [...memory.data.values()][0], saved = JSON.parse(raw);
  assert.equal(decodeNavigationSession(raw, 8), null);
  assert.equal(decodeNavigationSession(raw, 7, Date.now() + 25 * 3600000), null);
  assert.equal(decodeNavigationSession('x'.repeat(2000001), 7), null);
  saved.state.routes[0].coords[0] = [999, 0];
  assert.equal(decodeNavigationSession(JSON.stringify(saved), 7), null);
  const otherUser = new NavigationSessionStore(memory, 8); await otherUser.hydrate();
  assert.equal(otherUser.getSnapshot().destination, null); otherUser.dispose();
});
test('logout/clear while storage is loading cannot resurrect a previous route', async () => {
  const { store, memory } = await session(); await store.flush(); store.dispose();
  const raw = [...memory.data.values()][0]; let release;
  const slow = { ...memory, getItem: () => new Promise(resolve => { release = resolve; }) };
  const pending = new NavigationSessionStore(slow, 7), hydration = pending.hydrate();
  const clearing = pending.clear(); release(raw); await hydration; await clearing;
  assert.equal(pending.getSnapshot().destination, null); assert.equal(memory.data.size, 0); pending.dispose();
});
test('queued persistence cannot overwrite a later cancellation', async () => {
  const { store, memory } = await session();
  store.updateFix(fix()); const writing = store.flush(); const clearing = store.clear();
  await Promise.all([writing, clearing]); assert.equal(memory.data.size, 0); store.dispose();
});
test('new destination, cancellation and privacy reject even provider responses that ignore abort', async () => {
  const { store } = await session(); const requests = [];
  const calc = new RouteCalculationController(store, (...args) => new Promise(resolve => requests.push({ resolve, signal: args[2] })));
  const a = calc.calculate(destination, fix());
  const secondDestination = { ...destination, id: 'two' }; store.setDestination(secondDestination);
  const b = calc.calculate(secondDestination, fix());
  requests[1].resolve([{ ...route, id: 2 }]); await b;
  requests[0].resolve([{ ...route, id: 1 }]); assert.equal(await a, null);
  assert.equal(requests[0].signal.aborted, true); assert.equal(store.getSnapshot().routes[0].id, 2);
  const c = calc.calculate(secondDestination, fix()); calc.setPaused(true);
  requests[2].resolve([route]); assert.equal(await c, null);
  assert.equal(store.getSnapshot().routes[0].id, 2); assert.equal(store.getSnapshot().calculating, false);
  calc.setPaused(false); const d = calc.calculate(secondDestination, fix()); calc.cancel(); await store.clear();
  requests[3].resolve([route]); assert.equal(await d, null); assert.equal(store.getSnapshot().destination, null); store.dispose();
});
test('failed reroute preserves valid geometry and explicit error without a fake straight route', async () => {
  const { store } = await session();
  const calc = new RouteCalculationController(store, async () => { throw new Error('offline'); });
  await calc.calculate(destination, fix());
  assert.equal(store.getSnapshot().routes[0], route); assert.equal(store.getSnapshot().tripActive, true);
  assert.match(store.getSnapshot().error, /Se conserva/); await store.clear(); store.dispose();
});
test('route parser rejects provider failures and handles multiple legs without invented lane labels', () => {
  const { parseNavigationRoutes } = loader({ '../api/client': {} })('src/services/navigationRoutes.ts');
  for (const data of [{ code: 'NoRoute' }, { routes: [] }, { routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[-91, 999], [-91, 14]] } }] }]) assert.throws(() => parseNavigationRoutes(data));
  const step = (type, distance, modifier) => ({ name: 'Calle', distance, maneuver: { type, modifier, location: [-91, 14] } });
  const parsed = parseNavigationRoutes({ code: 'Ok', routes: [{ distance: 300, duration: 60,
    geometry: { coordinates: [[-91, 14], [-90.99, 14]] }, legs: [
      { steps: [step('depart', 100), step('turn', 100, 'right')] }, { steps: [step('turn', 100, 'left'), step('arrive', 0)] }] }] });
  assert.equal(parsed[0].steps[2].progressMeters, 200);
  assert.doesNotMatch(JSON.stringify(parsed), /carril/i);
});

test('stable route layers, marker and line head share one animation clock along a corner', () => {
  const h = embeddedMap();
  const geometry = progress.prepareRoute([[14, -91], [14, -90.999], [14.001, -90.999]]);
  const lines = [{ id: '0', selected: true, coordinates: geometry.points.map(p => ({ latitude: p.lat, longitude: p.lng })) }];
  h.routes(lines);
  const at = distance => { const p = progress.coordinateAtProgress(geometry, distance).point;
    h.update({ latitude: p.lat, longitude: p.lng, routeId: '0', progressMeters: distance, heading: 90, navigating: true, following: true }); };
  at(0); at(geometry.total); h.advance(450);
  const half = progress.coordinateAtProgress(geometry, geometry.total / 2).point;
  assert.ok(Math.abs(h.markers[0].position[0] - half.lat) < 1e-7);
  assert.ok(Math.abs(h.markers[0].position[1] - half.lng) < 1e-7);
  assert.deepEqual(json(h.polylines[1].points[0]), json(h.markers[0].position));
  assert.deepEqual(json(h.pans.at(-1)), json(h.markers[0].position));
  h.routes(lines); h.advance(900);
  assert.equal(h.polylines.length, 2); assert.equal(h.layers[0].clears, 0);
  assert.ok(h.messages.filter(m => m.type === 'REGION_CHANGE').length <= 3);
});
test('route alternatives update style in place, remove only obsolete paths and do not erase the GPS marker', () => {
  const h = embeddedMap(); const coordinates = coords.map(p => ({ latitude: p[0], longitude: p[1] }));
  h.routes([{ id: 'a', selected: true, coordinates }, { id: 'b', selected: false, coordinates }]);
  h.update({ latitude: 14, longitude: -91, heading: 0 });
  const firstLine = h.polylines[0], marker = h.markers[0];
  h.routes([{ id: 'a', selected: false, coordinates }, { id: 'b', selected: true, coordinates }]);
  assert.equal(h.polylines.length, 4); assert.equal(h.polylines[0], firstLine); assert.equal(h.markers[0], marker);
  h.routes([{ id: 'b', selected: true, coordinates }]);
  assert.equal(h.layers[0].removed.length, 2); assert.equal(h.layers[1].removed.length, 0);
});
test('a drag or pinch interrupts follow immediately, and recentre does not reset zoom', () => {
  for (const gesture of ['drag', 'pinch', 'zoom']) {
    const h = embeddedMap();
    const user = { latitude: 14, longitude: -91, heading: 0, following: true };
    h.update(user); h.update({ ...user, latitude: 14.001 }); h.advance(100);
    const count = h.pans.length;
    if (gesture === 'drag') h.events.dragstart();
    else if (gesture === 'pinch') h.domEvents.touchstart({ touches: [{}, {}] });
    else h.domEvents.click({ target: { closest: () => true } });
    h.advance(450); assert.equal(h.pans.length, count);
    h.window.__EUNICE_MAP_FOLLOW({ latitude: 14.001, longitude: -91 });
    assert.equal(h.pans.length, count + 1); h.advance(900); assert.equal(h.pans.length, count + 2);
    assert.equal(h.map.zoomControl.position, 'topright'); assert.equal(h.layers[0].clears, 0);
  }
});
test('reduced-motion mode moves directly to the real reading without an animation queue', () => {
  const h = embeddedMap({ reducedMotion: true });
  h.update({ latitude: 14, longitude: -91, heading: 0 }); h.update({ latitude: 14.001, longitude: -91, heading: 0 });
  assert.equal(h.markers[0].position[0], 14.001);
});
test('map remains mounted between tabs; modals are gated and toolbar cannot cover map zoom', () => {
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const screen = fs.readFileSync(path.join(root, 'src/screens/LiveMapScreen.tsx'), 'utf8');
  assert.match(app, /case 'map':\s*return null/);
  assert.match(app, /opacity: activeTab === 'map' \? 1 : 0/);
  assert.match(screen, /visible=\{active && showFleetModal\}/);
  assert.match(screen, /userMarker=\{!isPrivacyMode && userLocation/);
  assert.match(screen, /pilotToolbar: \{[\s\S]{0,160}backgroundColor/);
  assert.match(embeddedMap().html, /width: 48px/);
  assert.doesNotMatch(screen, /Conduce directo/);
});
