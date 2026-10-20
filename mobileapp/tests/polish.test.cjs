const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/navigation.cjs');
const { reactHarness, find, text, settle, memoryStorage } = require('./helpers/reactHarness.cjs');
const esm = value => ({ __esModule: true, default: value });
const payload = () => ({ latitud: 14.8, longitud: -91.5, velocidadKmh: 30, fechaHoraDispositivo: new Date().toISOString() });

test('offline archive survives more than 2000 fixes, old observation dates, and another journey', async () => {
  const storage = memoryStorage();
  const queue = loader({ '@react-native-async-storage/async-storage': esm(storage) })('src/services/offlineStorage.ts');
  for (let i = 0; i < 2101; i++) await queue.enqueueTelemetry(1, 7, payload());
  await queue.enqueueTelemetry(1, 9, { ...payload(), fechaHoraDispositivo: new Date(Date.now() - 2 * 86400000).toISOString() });
  assert.equal((await queue.readTelemetryQueue(1, 7)).length, 2101);
  assert.equal((await queue.readTelemetryQueue(1, 9)).length, 1);
  assert.deepEqual(Array.from(await queue.pendingTripIds(1)), [7, 9]);
  assert.equal((await queue.readTelemetryQueue(2, 7)).length, 0);
});

test('401/403 and rejected journey retain archive; acknowledgements remove only accepted fixes', async () => {
  const storage = memoryStorage(); let fail = 401; const sent = [];
  const load = loader({ '@react-native-async-storage/async-storage': esm(storage), './tokenStorage': { getAuthToken: async () => 'token' },
    '../api/client': esm({ post: async (_url, batch) => { sent.push(batch); if (fail) throw { response: { status: fail } }; return { data: { lecturas: batch.map(x => ({ idLectura: x.idLectura, estado: 'aceptada' })) } }; } }) });
  const queue = load('src/services/offlineStorage.ts'), delivery = load('src/services/telemetryDelivery.ts');
  await queue.enqueueTelemetry(1, 7, payload()); await queue.enqueueTelemetry(1, 9, payload());
  for (const status of [401, 403, 400]) {
    fail = status; await assert.rejects(delivery.flushPendingTelemetry(1));
    assert.equal(await delivery.pendingTelemetryCount(1), 2);
  }
  fail = 0;
  const result = await delivery.flushPendingTelemetry(1);
  assert.equal(result.remaining, 0);
  assert.equal(await delivery.pendingTelemetryCount(1), 0);
  assert.ok(sent.every(batch => batch.every(item => item.idViaje === 7 || item.idViaje === 9)));
});

test('HTTP failover never replays a mutation or an aborted read, and 401 identifies the rejected token', async () => {
  const storage = memoryStorage(); let responseError; let retries = 0;
  const client = Object.assign(async () => { retries++; return {}; }, { defaults: {}, interceptors: {
    request: { use() {} }, response: { use(_success, error) { responseError = error; } } } });
  const load = loader({ axios: esm({ create: () => client }), '@react-native-async-storage/async-storage': esm(storage),
    '../services/tokenStorage': { getAuthToken: async () => 'token' } });
  const events = load('src/services/authEvents.ts'); let rejected;
  events.onSessionExpired(token => rejected = token);
  load('src/api/client.ts');
  await assert.rejects(responseError({ config: { method: 'post', url: '/chat' } }));
  await assert.rejects(responseError({ code: 'ERR_CANCELED', config: { method: 'get', signal: { aborted: true } } }));
  assert.equal(retries, 0);
  await responseError({ config: { method: 'get' } }); assert.equal(retries, 1);
  await assert.rejects(responseError({ response: { status: 401 }, config: { url: '/telemetria/batch', headers: { Authorization: 'Bearer expired' } } }));
  assert.equal(rejected, 'expired');
});

test('places are isolated by user; unowned legacy history is recoverable and account deletion only clears its owner', async () => {
  const storage = memoryStorage();
  const places = loader({ '@react-native-async-storage/async-storage': esm(storage) })('src/services/userPlaces.ts');
  await storage.setItem(places.placeStorageKey(1, 'history'), '["Casa"]');
  await storage.setItem(places.placeStorageKey(2, 'history'), '["Terminal"]');
  await storage.setItem('@recent_destinations_history', '["Legacy"]');
  await places.retireLegacyPlaces();
  assert.match(await storage.getItem('@eunice_unowned_places_archive_v1'), /Legacy/);
  assert.equal(await storage.getItem('@recent_destinations_history'), null);
  await places.clearUserPlaces(1);
  assert.equal(await storage.getItem(places.placeStorageKey(1, 'history')), null);
  assert.match(await storage.getItem(places.placeStorageKey(2, 'history')), /Terminal/);
});

test('GPS freshness expires without inventing a new observation and rejects future timestamps', () => {
  const { isGpsFresh } = loader()('src/utils/trackingFreshness.ts');
  assert.equal(isGpsFresh(1000, 2000), true);
  assert.equal(isGpsFresh(1000, 17000), false);
  assert.equal(isGpsFresh(null, 2000), false);
  assert.equal(isGpsFresh(90000, 2000), false);
});

test('auth expiry stops tracking and preserves the archive; a delayed 401 from another token cannot end a new session', async () => {
  const harness = reactHarness(), storage = memoryStorage(), intervals = [];
  const user = { idUsuario: 1, nombreCompleto: 'Piloto', usuarioLogin: 'pilot', tipoRol: 'Piloto' };
  const jwt = exp => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64')}.signature`;
  let token = jwt(Math.floor(Date.now() / 1000) + 3600), stops = 0;
  await storage.setItem('@user_session', JSON.stringify(user));
  await storage.setItem('@eunice_telemetry_queue_1_7', 'retained archive');
  const showToast = () => {};
  const load = loader({ react: harness.React, 'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    '@react-native-async-storage/async-storage': esm(storage), './ToastContext': { useToast: () => ({ showToast }) },
    '../services/backgroundTelemetry': { stopBackgroundTracking: async () => { stops++; } },
    '../services/pushNotifications': { unregisterPushNotificationsAsync: async () => {} },
    '../services/tokenStorage': { getAuthToken: async () => token, clearAuthToken: async () => { token = null; }, setAuthToken: async value => { token = value; } },
    '../api/client': { ...esm({ defaults: {}, get: async () => ({ status: 200, data: user }) }), DEFAULT_API_URL: 'https://api.invalid/api', VALID_VPS_URLS: ['https://api.invalid/api'] },
  }, { atob, setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {} });
  const { AuthProvider } = load('src/context/AuthContext.tsx');
  const render = () => harness.render(AuthProvider, { children: null });
  render(); await settle(); assert.equal(render().props.value.user.idUsuario, 1);
  load('src/services/authEvents.ts').notifySessionExpired('old token'); await settle();
  assert.equal(render().props.value.user.idUsuario, 1);
  token = jwt(Math.floor(Date.now() / 1000) - 10);
  intervals.find(item => item.ms === 15000).fn(); await settle();
  assert.equal(render().props.value.user, null); assert.equal(token, null); assert.equal(stops, 1);
  assert.equal(await storage.getItem('@eunice_telemetry_queue_1_7'), 'retained archive');
  harness.dispose();
});

test('real tracking hook exposes denied background permission and ages a silent GPS without updating its timestamp', async () => {
  const harness = reactHarness(); const intervals = []; let now = Date.now(), sample;
  class Time extends Date { static now() { return now; } }
  const user = { idUsuario: 1, tipoRol: 'Piloto' };
  const subscription = () => ({ remove() {} });
  const load = loader({ react: harness.React, 'react-native': { AppState: { addEventListener: subscription } },
    axios: { isAxiosError: () => false }, '@react-native-community/netinfo': esm({ addEventListener: () => () => {} }),
    'expo-location': { Accuracy: { BestForNavigation: 6 }, requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
      watchHeadingAsync: async () => subscription(), watchPositionAsync: async (_options, callback) => { sample = callback; return subscription(); } },
    'expo-sensors': { Accelerometer: { setUpdateInterval() {}, addListener: subscription }, Gyroscope: { setUpdateInterval() {}, addListener: subscription } },
    '../api/client': esm({ get: async () => ({ status: 200, data: { idViaje: 7, idUsuario: 1 } }), post: async () => ({}) }),
    '../services/fleetConnection': { createFleetConnection: () => ({ resume() {}, stop() {}, send: () => false }) },
    '../services/openTelemetrySocket': { openTelemetrySocket() {} }, '../services/offlineStorage': { enqueueTelemetry: async () => 1 },
    '../services/trackingSource': { acquireTrackingSource: async () => 'source', trackingSourceId: async () => 'source' },
    '../services/telemetryDelivery': { flushPendingTelemetry: async () => ({ remaining: 0, sent: false }), pendingTelemetryCount: async () => 0 },
    '../services/backgroundTelemetry': { stopBackgroundTracking: async () => {}, startBackgroundTracking: async () => false, saveBackgroundTrackingContext: async () => {} },
  }, { Date: Time, setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {} });
  const { useLiveTelemetryStreamer } = load('src/hooks/useLiveTelemetryStreamer.ts');
  const component = () => useLiveTelemetryStreamer(user);
  const render = () => harness.render(component);
  render(); await settle(); render(); await settle();
  sample({ timestamp: now, coords: { latitude: 14.8, longitude: -91.5, accuracy: 5, speed: 12, heading: 90 } });
  let state = render(); await settle(); state = render();
  assert.equal(state.locationFresh, true); assert.equal(state.backgroundStatus, 'denied');
  const originalTimestamp = state.locationTimestamp;
  now += 16000; intervals.find(item => item.ms === 3000).fn();
  state = render(); assert.equal(state.phase, 'stale'); assert.equal(state.locationFresh, false);
  assert.equal(state.locationTimestamp, originalTimestamp);
  harness.dispose();
});

test('a pending background permission cannot restart tracking after a stop/privacy action', async () => {
  const storage = memoryStorage(); let grant, starts = 0;
  const load = loader({ 'react-native': { AppState: { currentState: 'active' }, Platform: { OS: 'ios' } },
    '@react-native-async-storage/async-storage': esm(storage), '@react-native-community/netinfo': esm({}),
    'expo-task-manager': { defineTask() {} }, './telemetryDelivery': { flushPendingTelemetry: async () => {} },
    'expo-location': { Accuracy: { BestForNavigation: 6 }, getForegroundPermissionsAsync: async () => ({ status: 'granted' }),
      requestBackgroundPermissionsAsync: () => new Promise(resolve => grant = resolve), hasStartedLocationUpdatesAsync: async () => false,
      startLocationUpdatesAsync: async () => { starts++; } },
  });
  const background = load('src/services/backgroundTelemetry.ts');
  const pending = background.startBackgroundTracking({ userId: 1, tripId: 7, paused: false, destination: null });
  await settle(); const stopping = background.stopBackgroundTracking(); grant({ status: 'granted' });
  assert.equal(await pending, false); await stopping; assert.equal(starts, 0);
  assert.equal(await storage.getItem('@eunice_background_tracking_context'), null);
});

test('chat keeps late responses, drafts and a delayed send inside their original conversation', async () => {
  const harness = reactHarness(); const storage = memoryStorage(); const gets = new Map(); let resolvePost;
  const user = { idUsuario: 1, nombreCompleto: 'Operador', tipoRol: 'Administrador' };
  const native = Object.fromEntries(['View', 'Text', 'Pressable', 'TextInput', 'ScrollView', 'KeyboardAvoidingView', 'ActivityIndicator', 'Modal'].map(name => [name, name]));
  Object.assign(native, { Platform: { OS: 'ios' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 430 }),
    Keyboard: { addListener: () => ({ remove() {} }) }, AppState: { addEventListener: () => ({ remove() {} }) } });
  class Socket { static OPEN = 1; static CONNECTING = 0; readyState = 0; close() { this.readyState = 3; this.onclose?.(); } }
  const colors = new Proxy({}, { get: () => '#102229' });
  const showToast = () => {};
  const load = loader({ react: harness.React, 'react-native': native,
    '@react-native-async-storage/async-storage': esm(storage), '@expo/vector-icons': { Feather: 'Icon' },
    '@react-native-community/netinfo': esm({ addEventListener: () => () => {} }),
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../services/tokenStorage': { getAuthToken: async () => 'token' }, '../context/ToastContext': { useToast: () => ({ showToast }) },
    '../theme/AppTheme': { useAppTheme: () => ({ colors }) }, '../api/client': { ...esm({ defaults: { baseURL: 'https://api.invalid/api' },
      get: url => url === '/usuarios' ? Promise.resolve({ data: [{ idUsuario: 2, nombreCompleto: 'Piloto 2', tipoRol: 'Piloto' }] })
        : url === '/chat/bloqueos' ? Promise.resolve({ data: [] }) : new Promise(resolve => gets.set(url, resolve)),
      post: () => new Promise(resolve => { resolvePost = resolve; }) }), buildWebSocketUrl: () => 'wss://api.invalid/ws' },
  }, { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, WebSocket: Socket });
  const { ChatScreen } = load('src/screens/ChatScreen.tsx');
  const render = () => harness.render(ChatScreen, { user });
  let tree = render(); await settle(); tree = render(); await settle();
  const input = () => find(tree, node => node.type === 'TextInput' && 'multiline' in node.props);
  input().props.onChangeText('Borrador general'); tree = render();
  find(tree, node => node.props?.icon === 'lock' && node.props?.onPress).props.onPress();
  tree = render(); await settle();
  gets.get('/chat/canal/2')({ data: [{ idMensaje: 'b', idEmisor: 2, nombreEmisor: 'Piloto 2', contenido: 'SOLO CANAL B', fechaHora: new Date().toISOString() }] });
  await settle(); tree = render();
  gets.get('/chat/general')({ data: [{ idMensaje: 'a', idEmisor: 9, nombreEmisor: 'Otro', contenido: 'SOLO CANAL A', fechaHora: new Date().toISOString() }] });
  await settle(); tree = render();
  assert.match(text(tree), /SOLO CANAL B/); assert.doesNotMatch(text(tree), /SOLO CANAL A/);
  input().props.onChangeText('Mensaje para B'); tree = render();
  find(tree, node => node.props?.accessibilityLabel === 'Enviar mensaje').props.onPress(); await settle();
  find(tree, node => node.props?.icon === 'radio' && node.props?.onPress).props.onPress(); tree = render();
  assert.equal(input().props.value, 'Borrador general');
  resolvePost({ data: { idMensaje: 'sent-b', idEmisor: 1, nombreEmisor: 'Operador', contenido: 'Mensaje para B', fechaHora: new Date().toISOString() } });
  await settle(); tree = render();
  assert.equal(input().props.value, 'Borrador general'); assert.doesNotMatch(text(tree), /Mensaje para B/);
  harness.dispose();
});
