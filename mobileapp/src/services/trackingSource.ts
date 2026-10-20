import api from '../api/client';
import { trackingSourceId } from './installationIdentity';
export { trackingSourceId } from './installationIdentity';

export const acquireTrackingSource = async (tripId: number, takeControl = false) => {
  const idFuente = await trackingSourceId();
  await api.post(`/viajes/${tripId}/fuente-rastreo`, { idFuente, tomarControl: takeControl });
  return idFuente;
};
