import { bearingBetween, distanceMeters, headingDifference, validHeading } from './navigationTelemetry';
import type { NavigationFix, NavigationRoute, RouteProgress } from '../types/navigation';

export const emptyProgress = (): RouteProgress => ({ distanceMeters: 0, segmentIndex: 0, timestamp: 0,
  offRouteCount: 0, matched: false, point: null, bearing: null });
export const validCoordinate = (p: { lat: number; lng: number }): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export interface RouteGeometry { points: { lat: number; lng: number }[]; cumulative: number[]; bearings: number[]; total: number }
export const prepareRoute = (coords: number[][]): RouteGeometry => {
  const points = coords.filter(c => c.length >= 2 && validCoordinate({ lat: c[0], lng: c[1] }))
    .map(c => ({ lat: c[0], lng: c[1] }));
  const cumulative = [0], bearings: number[] = [];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
    bearings.push(bearingBetween(points[i - 1], points[i]));
  }
  return { points, cumulative, bearings, total: cumulative.at(-1) ?? 0 };
};
export const coordinateAtProgress = (geometry: RouteGeometry, value: number) => {
  const { points, cumulative } = geometry;
  if (!points.length) return { point: { lat: 0, lng: 0 }, segmentIndex: 0 };
  const distance = Math.max(0, Math.min(geometry.total, value));
  let lo = 0, hi = Math.max(0, points.length - 2);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (cumulative[mid] <= distance) lo = mid; else hi = mid - 1; }
  const next = points[lo + 1] ?? points[lo];
  const length = (cumulative[lo + 1] ?? cumulative[lo]) - cumulative[lo];
  const t = length > 0 ? Math.max(0, Math.min(1, (distance - cumulative[lo]) / length)) : 0;
  return { point: { lat: points[lo].lat + (next.lat - points[lo].lat) * t,
    lng: points[lo].lng + (next.lng - points[lo].lng) * t }, segmentIndex: lo };
};

const projectSegment = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, p: { lat: number; lng: number }) => {
  const cos = Math.cos(p.lat * Math.PI / 180);
  const dx = (b.lng - a.lng) * 111_320 * cos, dy = (b.lat - a.lat) * 110_540;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1,
    (((p.lng - a.lng) * 111_320 * cos) * dx + ((p.lat - a.lat) * 110_540) * dy) / lengthSquared)) : 0;
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { point, t, distance: distanceMeters(point, p) };
};

// Match only a plausible window of travelled distance, not every future crossing of the route.
export const advanceRouteProgress = (geometry: RouteGeometry, fix: NavigationFix, previous: RouteProgress): RouteProgress => {
  if (!validCoordinate(fix) || !Number.isFinite(fix.timestamp) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0
    || !Number.isFinite(fix.speedKmh) || fix.timestamp <= previous.timestamp || geometry.points.length < 2) return previous;
  const elapsed = previous.timestamp ? Math.max(0, (fix.timestamp - previous.timestamp) / 1000) : 0;
  const speed = Math.max(0, Math.min(160, fix.speedKmh)) / 3.6;
  const uncertainty = Math.max(3, Math.min(35, fix.accuracy));
  const maxAdvance = previous.timestamp ? speed * Math.min(elapsed, 300) + Math.max(18, uncertainty * 1.5) : 180;
  const minProgress = Math.max(0, previous.distanceMeters - 10);
  const maxProgress = Math.min(geometry.total, previous.distanceMeters + Math.min(10_000, maxAdvance));
  const from = coordinateAtProgress(geometry, minProgress).segmentIndex;
  const to = coordinateAtProgress(geometry, maxProgress).segmentIndex;
  const course = fix.speedKmh >= 4 ? validHeading(fix.heading) : null;
  let best: { progress: number; distance: number; score: number } | null = null;
  for (let i = from; i <= to && i < geometry.points.length - 1; i++) {
    const p = projectSegment(geometry.points[i], geometry.points[i + 1], fix);
    const progress = geometry.cumulative[i] + (geometry.cumulative[i + 1] - geometry.cumulative[i]) * p.t;
    if (progress < minProgress || progress > maxProgress) continue;
    const angle = course == null ? 0 : Math.abs(headingDifference(course, geometry.bearings[i]));
    if (course != null && angle > 85) continue;
    const score = p.distance + angle * 0.08 + Math.abs(progress - previous.distanceMeters - speed * Math.min(elapsed, 10)) * 0.035;
    if (!best || score < best.score) best = { progress, distance: p.distance, score };
  }
  const tolerance = Math.max(8, Math.min(30, uncertainty * 1.5 + 4));
  const matched = fix.accuracy <= 35 && Boolean(best && best.distance <= tolerance);
  if (!matched) return { ...previous, timestamp: fix.timestamp, matched: false,
    offRouteCount: fix.accuracy <= 35 ? previous.offRouteCount + 1 : 0 };
  let progress = Math.max(previous.distanceMeters, best!.progress);
  // Do not consume a route while parked just because GPS wandered a few metres.
  if (previous.matched && fix.speedKmh < 2 && progress - previous.distanceMeters < Math.min(5, uncertainty)) progress = previous.distanceMeters;
  const at = coordinateAtProgress(geometry, progress);
  return { distanceMeters: progress, segmentIndex: at.segmentIndex, timestamp: fix.timestamp,
    offRouteCount: 0, matched: true, point: at.point, bearing: geometry.bearings[at.segmentIndex] ?? null };
};

export const remainingRoute = (geometry: RouteGeometry, progress: number) => {
  if (geometry.points.length < 2) return [];
  const at = coordinateAtProgress(geometry, progress);
  return [at.point, ...geometry.points.slice(at.segmentIndex + 1)].map(p => ({ latitude: p.lat, longitude: p.lng }));
};

export const nextRouteStep = (route: NavigationRoute, progress: number) => {
  let distance = 0;
  const steps = (route.steps ?? []).map((step, index) => {
    const at = step.progressMeters ?? distance;
    distance += Math.max(0, step.distance);
    return { step, at, index };
  });
  // Depart is not an upcoming turn; passed manoeuvres never become upcoming again.
  const next = steps.find(s => s.step.type !== 'depart' && s.at > progress + 8)
    ?? steps.findLast(s => s.step.type === 'arrive');
  return next ? { ...next.step, index: next.index, distanceMeters: Math.max(0, Math.round(next.at - progress)) } : null;
};

export const remainingRouteInfo = (route: NavigationRoute, geometry: RouteGeometry, progress: number) => {
  const ratio = geometry.total > 0 ? Math.max(0, Math.min(1, (geometry.total - progress) / geometry.total)) : 1;
  return { distanceKm: Math.round(route.distKm * ratio * 10) / 10,
    durationMin: Math.max(0, Math.ceil(route.durationMin * ratio)) };
};

// Cosmetic estimate only. The original reading remains available for telemetry/history.
export const estimateGpsPosition = (previous: NavigationFix | null, fix: NavigationFix): NavigationFix => {
  if (!previous || fix.timestamp - previous.timestamp > 15_000) return fix;
  if (fix.timestamp <= previous.timestamp) return previous;
  const distance = distanceMeters(previous, fix);
  const elapsed = (fix.timestamp - previous.timestamp) / 1000;
  if (distance > Math.max(50, (fix.speedKmh / 3.6 + 15) * elapsed + fix.accuracy + previous.accuracy)) return { ...previous, timestamp: fix.timestamp };
  if (fix.speedKmh < 2 && distance < Math.min(4, Math.max(1.5, fix.accuracy * 0.4))) return { ...fix, lat: previous.lat, lng: previous.lng };
  const alpha = fix.accuracy <= 8 || fix.speedKmh >= 30 ? 1 : 0.75;
  return { ...fix, lat: previous.lat + (fix.lat - previous.lat) * alpha, lng: previous.lng + (fix.lng - previous.lng) * alpha };
};
