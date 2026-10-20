import type { Marker, LatLngTuple } from 'leaflet';

const motion = new WeakMap<Marker, { frame?: number; target: LatLngTuple }>();
export const stopMarkerMotion = (marker: Marker) => {
  const previous = motion.get(marker);
  if (previous?.frame != null) cancelAnimationFrame(previous.frame);
  motion.delete(marker);
};

// Animate only between received fixes, without projecting a fictitious position.
export const animateMarkerPosition = (marker: Marker, target: LatLngTuple, duration = 950) => {
  const previous = motion.get(marker);
  if (previous?.target[0] === target[0] && previous.target[1] === target[1]) return;
  stopMarkerMotion(marker);
  const from = marker.getLatLng();
  const started = performance.now();
  const next = { target, frame: undefined as number | undefined };
  motion.set(marker, next);
  const update = (now: number) => {
    if (motion.get(marker) !== next) return;
    const progress = Math.min(1, (now - started) / duration);
    marker.setLatLng([from.lat + (target[0] - from.lat) * progress, from.lng + (target[1] - from.lng) * progress]);
    next.frame = progress < 1 ? requestAnimationFrame(update) : undefined;
  };
  next.frame = requestAnimationFrame(update);
};
