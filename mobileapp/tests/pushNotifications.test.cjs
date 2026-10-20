const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/navigation.cjs');
const { memoryStorage, settle } = require('./helpers/reactHarness.cjs');
const esm = value => ({ __esModule: true, default: value });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function setup(os = 'ios') {
  const storage = memoryStorage(), calls = [], timers = new Map(), events = {};
  let token = 'account-A', permissions = { granted: true, canAskAgain: true }, expoToken = 'ExpoPushToken[phone]';
  let request = async () => ({ granted: true }), fail = false, post;
  const notifications = {
    AndroidImportance: { MAX: 5 }, IosAuthorizationStatus: { PROVISIONAL: 3 },
    setNotificationHandler: handler => { events.handler = data => handler.handleNotification({ request: { content: { data } } }); },
    setNotificationChannelAsync: async (id, options) => { calls.push({ type: 'channel', id, options }); },
    getPermissionsAsync: async () => permissions,
    requestPermissionsAsync: async () => { calls.push({ type: 'permission' }); return request(); },
    getExpoPushTokenAsync: async options => { calls.push({ type: 'token', options }); return { data: expoToken }; },
    addPushTokenListener: fn => { events.rotation = fn; return { remove() { delete events.rotation; } }; },
    dismissAllNotificationsAsync: async () => { calls.push({ type: 'dismiss' }); },
    setBadgeCountAsync: async n => { calls.push({ type: 'badge', n }); },
    clearLastNotificationResponseAsync: async () => {},
  };
  const service = loader({ '@react-native-async-storage/async-storage': esm(storage),
    'expo-constants': esm({ easConfig: { projectId: 'eunice-project' } }), 'expo-device': { isDevice: true },
    'expo-notifications': notifications,
    'react-native': { Platform: { OS: os }, AppState: { addEventListener: (_, fn) => { events.active = fn; return { remove() { delete events.active; } }; } } },
    '@react-native-community/netinfo': esm({ addEventListener: fn => { events.network = fn; return () => { delete events.network; }; } }),
    './tokenStorage': { getAuthToken: async () => token },
    '../api/client': esm({ post: async (...args) => { calls.push({ type: 'post', args }); if (fail) throw Error('offline'); if (post) await post(); },
      delete: async (...args) => { calls.push({ type: 'delete', args }); } }),
  }, { setTimeout: (fn, ms) => { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) })('src/services/pushNotifications.ts');
  return { service, storage, calls, events, timers, setToken: value => { token = value; },
    setPermissions: value => { permissions = value; }, setRequest: value => { request = value; },
    setExpoToken: value => { expoToken = value; }, setFailure: value => { fail = value; }, setPost: value => { post = value; } };
}

for (const os of ['ios', 'android']) {
  test(`${os}: registers the Expo project and installation with the captured auth token`, async () => {
    const s = setup(os);
    assert.equal(await s.service.registerPushNotificationsAsync(), 'registered');
    const post = s.calls.find(c => c.type === 'post');
    assert.equal(post.args[0], '/notificaciones/dispositivos');
    assert.equal(post.args[1].plataforma, os);
    assert.match(post.args[1].deviceId, new RegExp(`^${os}-`));
    assert.equal(post.args[2].headers.Authorization, 'Bearer account-A');
    assert.equal(s.calls.some(c => c.type === 'channel' && c.id === 'operaciones'), os === 'android');
    assert.equal(s.calls.find(c => c.type === 'token').options.projectId, 'eunice-project');
  });
}

test('simultaneous registration shares one installation identity and serializes server writes', async () => {
  const s = setup();
  const statuses = await Promise.all([s.service.registerPushNotificationsAsync(), s.service.registerPushNotificationsAsync()]);
  assert.deepEqual(statuses, ['registered', 'registered']);
  const posts = s.calls.filter(c => c.type === 'post');
  assert.equal(posts[0].args[1].deviceId, posts[1].args[1].deviceId);
});

test('permission denial does not register, and iOS provisional authorization is usable', async () => {
  const s = setup();
  s.setPermissions({ granted: false, canAskAgain: false });
  assert.equal(await s.service.registerPushNotificationsAsync(), 'denied');
  assert.equal(s.calls.length, 0);
  s.setPermissions({ granted: false, canAskAgain: false, ios: { status: 3 } });
  assert.equal(await s.service.registerPushNotificationsAsync(), 'registered');
});

test('logout is not held by a permission dialog and its late answer cannot register the old account', async () => {
  const s = setup(), dialog = deferred();
  s.setPermissions({ granted: false, canAskAgain: true }); s.setRequest(() => dialog.promise);
  const registration = s.service.registerPushNotificationsAsync(); await settle();
  s.setToken(null);
  await s.service.unregisterPushNotificationsAsync('account-A');
  dialog.resolve({ granted: true });
  assert.equal(await registration, 'cancelled');
  assert.equal(s.calls.filter(c => c.type === 'post').length, 0);
});

test('account switch during registration compensates the old request before binding the new one', async () => {
  const s = setup(), pending = deferred(); s.setPost(() => pending.promise);
  const old = s.service.registerPushNotificationsAsync(); await settle();
  s.setToken('account-B'); s.setPost(null);
  const next = s.service.registerPushNotificationsAsync(); pending.resolve();
  assert.equal(await old, 'cancelled'); assert.equal(await next, 'registered');
  const writes = s.calls.filter(c => ['post', 'delete'].includes(c.type));
  assert.deepEqual(writes.map(c => [c.type, c.args.at(-1).headers.Authorization]),
    [['post', 'Bearer account-A'], ['delete', 'Bearer account-A'], ['post', 'Bearer account-B']]);
});

test('temporary failure retries with backoff and stop removes every listener/timer', async () => {
  const s = setup(), statuses = []; s.setFailure(true);
  const stop = s.service.maintainPushRegistration(value => statuses.push(value)); await settle();
  assert.deepEqual(statuses, ['error']);
  const timer = [...s.timers.values()][0]; assert.equal(timer.ms, 5000);
  s.setFailure(false); timer.fn(); await settle();
  assert.deepEqual(statuses, ['error', 'registered']);
  stop(); assert.equal(s.events.active, undefined); assert.equal(s.events.rotation, undefined);
  assert.equal(s.events.network, undefined); assert.equal(s.timers.size, 0);
});

test('return from Settings, token rotation and reconnection re-register without re-prompting', async () => {
  const s = setup(); s.setPermissions({ granted: false, canAskAgain: false });
  const stop = s.service.maintainPushRegistration(() => {}); await settle();
  s.setPermissions({ granted: true }); s.events.active('active'); await settle();
  assert.equal(s.calls.filter(c => c.type === 'post').length, 1);
  s.setExpoToken('ExpoPushToken[rotated]'); s.events.rotation(); await settle();
  assert.equal(s.calls.filter(c => c.type === 'post').at(-1).args[1].expoPushToken, 'ExpoPushToken[rotated]');
  assert.equal(s.calls.some(c => c.type === 'permission'), false);
  stop();
  const recovering = setup(); recovering.setFailure(true);
  const stopRecovery = recovering.service.maintainPushRegistration(() => {}); await settle();
  recovering.events.network({ isConnected: false }); recovering.setFailure(false);
  recovering.events.network({ isConnected: true, isInternetReachable: true }); await settle();
  assert.equal(recovering.calls.filter(c => c.type === 'post').length, 2); stopRecovery();
});

test('logout removes delivered notifications/badge and suppresses foreground notices when signed out', async () => {
  const s = setup(); await s.service.registerPushNotificationsAsync();
  assert.equal((await s.events.handler()).shouldShowBanner, true);
  s.setToken(null); await s.service.unregisterPushNotificationsAsync('account-A');
  assert.equal(await s.storage.getItem('@eunice_expo_push_token'), null);
  assert.ok(s.calls.some(c => c.type === 'dismiss')); assert.ok(s.calls.some(c => c.type === 'badge' && c.n === 0));
  assert.equal((await s.events.handler()).shouldShowBanner, false);
});

test('late push for another recipient cannot display in foreground or navigate as the new account', async () => {
  const s = setup(); await s.storage.setItem('@user_session', JSON.stringify({ idUsuario: 2 }));
  assert.equal(s.service.isPushForUser({ recipientId: '1' }, 2), false);
  assert.equal((await s.events.handler({ recipientId: '1' })).shouldShowBanner, false);
  assert.equal((await s.events.handler({ recipientId: '2' })).shouldShowBanner, true);
});

test('Firebase config rejects a different Android app and accepts only the Eunice package', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.resolve(__dirname, '../app.config.js'), 'utf8');
  const config = { android: { package: 'com.transporteseunice.mobile' }, extra: { firebaseProjectId: 'transportes-eunice' } };
  let file = { project_info: { project_id: 'transportes-eunice', project_number: '123' }, client: [{
    client_info: { mobilesdk_app_id: '1:123:android:fixture', android_client_info: { package_name: 'pro.santis.clinic' } },
    api_key: [{ current_key: 'public-client-key' }],
  }] };
  const mod = { exports: {} };
  vm.runInNewContext(source, { module: mod, __dirname: '/app', process: { env: {} }, require: name => name === 'node:fs'
    ? { existsSync: () => true, readFileSync: () => JSON.stringify(file) } : require(name) });
  assert.throws(() => mod.exports({ config }), /no contiene/);
  file.client[0].client_info.android_client_info.package_name = 'com.transporteseunice.mobile';
  assert.match(mod.exports({ config }).android.googleServicesFile, /google-services.json$/);
  file.project_info.project_id = 'another-project';
  assert.throws(() => mod.exports({ config }), /otro proyecto/);
  file.project_info.project_id = 'transportes-eunice';
  delete file.client[0].api_key;
  assert.throws(() => mod.exports({ config }), /incompleta/);
});
