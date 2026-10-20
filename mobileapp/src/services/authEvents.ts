// Kept independent of React so foreground requests and background tasks share it.
const listeners = new Set<(token?: string) => void>();
export const onSessionExpired = (listener: (token?: string) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const notifySessionExpired = (token?: string) => listeners.forEach(listener => listener(token));
export const shouldRetryRequest = (method?: string, code?: string, aborted = false) =>
  !aborted && code !== 'ERR_CANCELED' && ['get', 'head', 'options'].includes((method ?? 'get').toLowerCase());
