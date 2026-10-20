import type { ChatOpenTarget } from '../screens/ChatScreen';

export type PushTab = 'map' | 'telemetry' | 'alerts' | 'trips' | 'buses' | 'routes' | 'chat' | 'users';
export interface TripPushTarget { tripId: number; requestId: number }
export interface AlertPushTarget { section: 'alerts' | 'ranking'; period?: string; requestId: number }
interface PushTarget { tab: PushTab; chat?: ChatOpenTarget; trip?: TripPushTarget; alerts?: AlertPushTarget }

const positiveId = (value: unknown): number | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export const getPushTarget = (data: Record<string, unknown> | undefined,
  user: { idUsuario: number; tipoRol: string }, requestId = Date.now()): PushTarget | null => {
  if (!data || (data.recipientId != null && Number(data.recipientId) !== user.idUsuario)) return null;
  const admin = user.tipoRol === 'Administrador' || user.tipoRol === 'SuperAdministrador';
  const allowed: PushTab[] = ['map', 'trips', 'routes', 'chat'];
  if (user.tipoRol === 'Piloto') allowed.push('telemetry');
  if (admin || user.tipoRol === 'Supervisor') allowed.push('alerts', 'buses');
  if (admin) allowed.push('users');
  if (!allowed.includes(data.tab as PushTab)) return null;
  const target: PushTarget = { tab: data.tab as PushTab };
  if (target.tab === 'chat') {
    const conversationId = typeof data.conversationId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.conversationId) ? data.conversationId : undefined;
    const channelId = positiveId(data.channelId);
    target.chat = conversationId && (data.type === 'passenger_message' || data.type === 'content_report')
      ? { mode: 'passengers', conversationId, requestId }
      : channelId ? { mode: 'private', channelId, requestId } : { mode: 'general', requestId };
  }
  if (target.tab === 'trips') {
    const tripId = positiveId(data.tripId);
    if (tripId) target.trip = { tripId, requestId };
  }
  if (target.tab === 'alerts') {
    const period = typeof data.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.period) ? data.period : undefined;
    target.alerts = { section: data.section === 'ranking' ? 'ranking' : 'alerts', period, requestId };
  }
  return target;
};
