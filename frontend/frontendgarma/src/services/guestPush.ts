import api from './api';

export const supportsGuestPush = () => window.isSecureContext && 'serviceWorker' in navigator
  && 'PushManager' in window && 'Notification' in window;

export const subscribeGuestPush = async (token: string, publicKey: string) => {
  if (!supportsGuestPush()) throw new Error('Este navegador no admite notificaciones. En iPhone, abre el enlace desde una app añadida a la pantalla de inicio.');
  // Permission is requested directly from the button gesture, before network work.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se concedió permiso. Puedes activarlo en los ajustes del navegador.');
  await navigator.serviceWorker.register('/passenger-push-sw.js', { scope: '/viaje/' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('El navegador no pudo activar los avisos. Vuelve a intentarlo.')), 15_000); }),
  ]).finally(() => clearTimeout(timer));
  const previous = await registration.pushManager.getSubscription();
  const binary = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - publicKey.length % 4) % 4));
  const key = Uint8Array.from(binary, char => char.charCodeAt(0));
  const subscription = previous ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.buffer });
  try {
    await api.post(`/public/viajes/${encodeURIComponent(token)}/notificaciones`, subscription.toJSON());
  } catch (error) {
    if (!previous) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
};

export const unsubscribeGuestPush = async (token: string) => {
  await api.delete(`/public/viajes/${encodeURIComponent(token)}/notificaciones`);
  const registration = await navigator.serviceWorker.getRegistration('/viaje/');
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
};
