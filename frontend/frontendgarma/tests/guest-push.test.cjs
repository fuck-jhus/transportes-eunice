const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const setup = (permission = 'granted', fail = false) => {
  const calls = [];
  const subscription = { toJSON: () => ({ endpoint: 'https://provider.test/endpoint' }), unsubscribe: async () => calls.push('unsubscribe') };
  const registration = { pushManager: { getSubscription: async () => null,
    subscribe: async () => { calls.push('subscribe'); return subscription; } } };
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../src/services/guestPush.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, Uint8Array, atob, setTimeout, clearTimeout,
      window: { isSecureContext: true, Notification: {}, PushManager: {} },
      Notification: { requestPermission: async () => { calls.push('permission'); return permission; } },
      navigator: { serviceWorker: { register: async () => calls.push('register'), ready: Promise.resolve(registration) } },
      require: () => ({ __esModule: true, default: { post: async () => { calls.push('post'); if (fail) throw new Error('Offline'); } } }) });
  return { service: module.exports, calls };
};

test('guest push asks permission only on activation and registers after consent', async () => {
  const s = setup(); assert.deepEqual(s.calls, []);
  await s.service.subscribeGuestPush('guest-token', 'BAECAw');
  assert.deepEqual(s.calls, ['permission', 'register', 'subscribe', 'post']);
});

test('denied permission sends nothing and failed server binding removes a newly created subscription', async () => {
  const denied = setup('denied'); await assert.rejects(denied.service.subscribeGuestPush('guest-token', 'BAECAw'));
  assert.deepEqual(denied.calls, ['permission']);
  const offline = setup('granted', true); await assert.rejects(offline.service.subscribeGuestPush('guest-token', 'BAECAw'));
  assert.equal(offline.calls.at(-1), 'unsubscribe');
});

test('service worker opens only a same-origin valid trip link, including normal 32-character tokens', async () => {
  const events = {}; const shown = []; const opened = [];
  const origin = 'https://transporteseunice.test';
  const browserClients = { matchAll: async () => [], openWindow: async url => opened.push(url) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../public/passenger-push-sw.js'), 'utf8'), {
    URL, clients: browserClients, self: { addEventListener: (name, fn) => { events[name] = fn; }, location: { origin },
      registration: { showNotification: async (_title, data) => shown.push(data) } },
  });
  let pending; const token = 'a'.repeat(32);
  events.push({ data: { json: () => ({ url: '/viaje/' + token, notificationId: 'one' }) }, waitUntil: p => { pending = p; } });
  await pending; assert.equal(shown[0].data.url, '/viaje/' + token);
  events.notificationclick({ notification: { data: shown[0].data, close() {} }, waitUntil: p => { pending = p; } });
  await pending; assert.equal(opened[0], origin + '/viaje/' + token);
  events.notificationclick({ notification: { data: { url: 'https://attacker.test/viaje/' + token }, close() {} }, waitUntil: p => { pending = p; } });
  assert.equal(opened.length, 1);
});
