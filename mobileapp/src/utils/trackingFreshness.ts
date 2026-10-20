export const GPS_FRESH_MS = 15_000;
export const isGpsFresh = (timestamp: number | null | undefined, now = Date.now()) =>
  timestamp != null && now - timestamp <= GPS_FRESH_MS && timestamp <= now + 5_000;
