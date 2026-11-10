import type { Marker, LatLngTuple } from 'leaflet';

// Movimiento continuo de marcadores entre lecturas GPS.
// Cada tramo dura lo mismo que el tiempo real entre las dos últimas lecturas,
// así el bus llega a su posición justo cuando entra la siguiente y nunca se queda quieto a medias.
// Nunca se proyecta una posición inventada: solo se recorre el tramo entre dos lecturas reales.

const MIN_SEGMENT_MS = 350;
const MAX_SEGMENT_MS = 4_000;
const DEFAULT_SEGMENT_MS = 1_000;
const TELEPORT_KM = 2;
const HEADING_MIN_METERS = 4;

interface MotionState {
  frame?: number;
  target: LatLngTuple;
  receivedAt: number;
  heading: number | null;
}

const motion = new WeakMap<Marker, MotionState>();

const toRad = (deg: number) => (deg * Math.PI) / 180;

export const distanceMeters = (a: LatLngTuple, b: LatLngTuple) => {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Rumbo en grados (0 = norte, 90 = este).
export const bearingDegrees = (a: LatLngTuple, b: LatLngTuple) => {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

export const segmentDuration = (sincePreviousMs: number | null) => {
  if (sincePreviousMs == null || !Number.isFinite(sincePreviousMs)) return DEFAULT_SEGMENT_MS;
  return Math.min(MAX_SEGMENT_MS, Math.max(MIN_SEGMENT_MS, sincePreviousMs));
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const stopMarkerMotion = (marker: Marker) => {
  const previous = motion.get(marker);
  if (previous?.frame != null) cancelAnimationFrame(previous.frame);
  motion.delete(marker);
};

export const getMarkerHeading = (marker: Marker) => motion.get(marker)?.heading ?? null;

export const animateMarkerPosition = (
  marker: Marker,
  target: LatLngTuple,
  onHeading?: (degrees: number) => void,
) => {
  const previous = motion.get(marker);
  if (previous && previous.target[0] === target[0] && previous.target[1] === target[1]) return;

  const now = performance.now();
  const lastTarget = previous?.target ?? [marker.getLatLng().lat, marker.getLatLng().lng] as LatLngTuple;
  let heading = previous?.heading ?? null;
  if (distanceMeters(lastTarget, target) >= HEADING_MIN_METERS) {
    heading = bearingDegrees(lastTarget, target);
    onHeading?.(heading);
  }

  if (previous?.frame != null) cancelAnimationFrame(previous.frame);
  const from = marker.getLatLng();
  const next: MotionState = { target, receivedAt: now, heading };
  motion.set(marker, next);

  const jumpKm = distanceMeters([from.lat, from.lng], target) / 1000;
  if (jumpKm > TELEPORT_KM || prefersReducedMotion()) {
    marker.setLatLng(target);
    return;
  }

  const duration = segmentDuration(previous ? now - previous.receivedAt : null);
  const update = (frameNow: number) => {
    if (motion.get(marker) !== next) return;
    const progress = Math.min(1, (frameNow - now) / duration);
    marker.setLatLng([from.lat + (target[0] - from.lat) * progress, from.lng + (target[1] - from.lng) * progress]);
    next.frame = progress < 1 ? requestAnimationFrame(update) : undefined;
  };
  next.frame = requestAnimationFrame(update);
};
