/* global self, clients */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Show a generic visible notice. */ }
  const url = typeof data.url === 'string' && /^\/viaje\/[A-Za-z0-9_-]{24,96}$/.test(data.url) ? data.url : '/';
  event.waitUntil(self.registration.showNotification('Respuesta de Transportes Eunice', {
    body: 'El conductor o el centro de control respondió a tu conversación.',
    tag: typeof data.notificationId === 'string' ? data.notificationId : 'eunice-respuesta',
    data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin || !/^\/viaje\/[A-Za-z0-9_-]{24,96}$/.test(target.pathname)) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const current = windows.find(window => window.url === target.href);
    if (current) return current.focus();
    return clients.openWindow(target.href);
  }));
});
