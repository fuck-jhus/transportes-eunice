export interface PositionFix {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number;
}

export const validHeading = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360 ? value : null;

export const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const rad = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
};

export const bearingBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad)
    - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
};

export const headingDifference = (a: number, b: number): number => ((b - a + 540) % 360) - 180;

export const smoothHeading = (previous: number | null, next: number): number =>
  previous == null ? next : (previous + headingDifference(previous, next) * 0.65 + 360) % 360;

// GPS course describes vehicle movement. Compass describes the phone orientation.
// Never turn a missing heading into a valid north bearing, or gyro rate into degrees.
export const resolveNavigationHeading = (
  gpsHeading: unknown,
  speedKmh: number,
  previous: PositionFix | null,
  current: PositionFix,
  compassHeading: number | null,
  lastCourse: number | null,
): number | null => {
  if (speedKmh >= 4) {
    const gps = validHeading(gpsHeading);
    if (gps != null) return gps;
    if (previous && current.timestamp > previous.timestamp && current.timestamp - previous.timestamp <= 30_000
      && distanceMeters(previous, current) >= Math.max(6, previous.accuracy, current.accuracy)) {
      return bearingBetween(previous, current);
    }
    return lastCourse;
  }
  return validHeading(compassHeading) ?? lastCourse;
};

export const canUseLocalGps = (role: string | undefined, privacy: boolean): boolean => role === 'Piloto' && !privacy;
export const canPublishTelemetry = (role: string | undefined, tripId: number | undefined, privacy: boolean): boolean =>
  canUseLocalGps(role, privacy) && Boolean(tripId);
