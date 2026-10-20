import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import api from '../services/api';
import { subscribeGuestPush, supportsGuestPush, unsubscribeGuestPush } from '../services/guestPush';

export const GuestPushControls = ({ token }: { token: string }) => {
  const [key, setKey] = useState('');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = supportsGuestPush();
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!supported) return;
    try {
      const response = await api.get<{ publicKey: string; subscribed: boolean }>(`/public/viajes/${encodeURIComponent(token)}/notificaciones`, { signal });
      if (signal?.aborted) return;
      setKey(response.data.publicKey);
      setActive(response.data.subscribed && Notification.permission === 'granted'); setError('');
    } catch {
      if (!signal?.aborted) setError('No se pudo comprobar el estado de los avisos.');
    }
  }, [supported, token]);
  useEffect(() => {
    const abort = new AbortController();
    queueMicrotask(() => { if (!abort.signal.aborted) void refresh(abort.signal); });
    return () => abort.abort();
  }, [refresh]);
  useEffect(() => {
    const link = document.createElement('link'); link.rel = 'manifest'; link.href = '/passenger.webmanifest';
    document.head.appendChild(link); return () => link.remove();
  }, []);

  const toggle = async () => {
    setBusy(true); setError('');
    try {
      if (active) await unsubscribeGuestPush(token);
      else await subscribeGuestPush(token, key);
      setActive(!active);
    } catch (failure) {
      setError(failure instanceof Error && !('isAxiosError' in failure) ? failure.message : 'No se pudo cambiar el permiso de avisos. Vuelve a intentarlo.');
    } finally { setBusy(false); }
  };

  return <div className="public-chat-start public-chat-notifications" aria-busy={busy}>
    {supported ? <>
      <button type="button" disabled={busy || (!key && !error)} onClick={() => void (key ? toggle() : refresh())}>
        {active ? <BellOff size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
        {busy ? 'Guardando avisos…' : !key ? error ? 'Volver a comprobar' : 'Comprobando avisos…' : active ? 'Desactivar avisos' : 'Avisarme cuando respondan'}
      </button>
      <p role="status">{error || (active ? 'Avisos activados para esta conversación hasta que termine o venza el enlace.' : 'Recibe un aviso aunque cierres esta página. Puedes desactivarlo aquí.')}</p>
    </> : <p>Tu navegador no ofrece avisos en segundo plano. En iPhone, añade este enlace a la pantalla de inicio y ábrelo desde allí. Puedes seguir consultando las respuestas aquí.</p>}
  </div>;
};
