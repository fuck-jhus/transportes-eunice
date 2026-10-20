import type { NavigationCamera, NavigationFix, NavigationPlace, NavigationRoute, NavigationSession } from '../types/navigation';
import { advanceRouteProgress, emptyProgress, prepareRoute, validCoordinate, type RouteGeometry } from '../utils/routeProgress';

interface SessionStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown>; removeItem(key: string): Promise<unknown> }
export const emptyNavigationSession = (): NavigationSession => ({ assignedTripId: null, assignedTripVersion: null, assignedTripRevision: null, destination: null, routes: [], selectedRouteIndex: 0,
  tripActive: false, progress: emptyProgress(), followUser: true, camera: null, updatedAt: Date.now(), calculating: false, error: null });

export const decodeNavigationSession = (raw: string | null, userId: number, now = Date.now()): NavigationSession | null => {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const saved = JSON.parse(raw);
    const s = saved.state as NavigationSession;
    if (saved.version !== 1 || saved.userId !== userId || !s || !Number.isFinite(s.updatedAt)
      || now - s.updatedAt > 24 * 60 * 60 * 1000 || s.updatedAt > now + 60_000) return null;
    if (!s.destination || !validCoordinate(s.destination) || typeof s.destination.id !== 'string'
      || typeof s.destination.address !== 'string' || typeof s.destination.name !== 'string' || s.destination.name.length > 200) return null;
    if (!Array.isArray(s.routes) || s.routes.length > 5 || s.routes.some(r => !Array.isArray(r.coords) || r.coords.length < 2
      || r.coords.length > 30_000 || !Number.isFinite(r.id) || !Number.isFinite(r.distKm) || r.distKm < 0 || !Number.isFinite(r.durationMin) || r.durationMin < 0
      || r.coords.some(c => !Array.isArray(c) || !validCoordinate({ lat: c[0], lng: c[1] }))
      || (r.steps != null && (!Array.isArray(r.steps) || r.steps.some(step => typeof step.instruction !== 'string'
        || !Number.isFinite(step.distance) || !Array.isArray(step.location) || !validCoordinate({ lat: step.location[0], lng: step.location[1] })))))) return null;
    const selectedRouteIndex = Number.isInteger(s.selectedRouteIndex) && s.selectedRouteIndex >= 0 && s.selectedRouteIndex < s.routes.length ? s.selectedRouteIndex : 0;
    const geometry = prepareRoute(s.routes[selectedRouteIndex]?.coords ?? []);
    const distance = Number.isFinite(s.progress?.distanceMeters) ? Math.max(0, Math.min(geometry.total, s.progress.distanceMeters)) : 0;
    const camera = s.camera && validCoordinate({ lat: s.camera.latitude, lng: s.camera.longitude })
      && s.camera.latitudeDelta > 0 && s.camera.latitudeDelta <= 180 && s.camera.longitudeDelta > 0 && s.camera.longitudeDelta <= 360 ? s.camera : null;
    return { ...emptyNavigationSession(), assignedTripId: Number.isInteger(s.assignedTripId) && (s.assignedTripId ?? 0) > 0 ? s.assignedTripId : null,
      assignedTripVersion: typeof s.assignedTripVersion === 'string' ? s.assignedTripVersion : null, destination: s.destination, routes: s.routes, selectedRouteIndex,
      assignedTripRevision: Number.isInteger(s.assignedTripRevision) ? s.assignedTripRevision : null,
      tripActive: Boolean(s.tripActive && s.routes.length), followUser: s.followUser !== false, camera,
      progress: { ...emptyProgress(), distanceMeters: distance,
        timestamp: Number.isFinite(s.progress?.timestamp) && s.progress.timestamp <= now ? s.progress.timestamp : 0 }, updatedAt: s.updatedAt };
  } catch { return null; }
};

export class NavigationSessionStore {
  private state = emptyNavigationSession();
  private listeners = new Set<() => void>();
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private geometry: RouteGeometry = prepareRoute([]);
  private loaded = false;
  constructor(private storage: SessionStorage, readonly userId: number | undefined) {}
  getSnapshot = () => this.state;
  getGeometry = () => this.geometry;
  isLoaded = () => this.loaded;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit = () => this.listeners.forEach(listener => listener());
  private key = () => `@eunice_navigation_v1_${this.userId}`;
  private update = (patch: Partial<NavigationSession>, critical = false) => {
    this.revision++;
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    if (patch.routes || patch.selectedRouteIndex !== undefined) this.geometry = prepareRoute(this.state.routes[this.state.selectedRouteIndex]?.coords ?? []);
    this.emit();
    if (this.loaded) {
      if (critical) void this.flush();
      else if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 3000);
    }
  };
  hydrate = async () => {
    const revision = this.revision;
    const raw = this.userId ? await this.storage.getItem(this.key()).catch(() => null) : null;
    if (revision === this.revision && this.userId) {
      const restored = decodeNavigationSession(raw, this.userId);
      if (restored) { this.state = restored; this.geometry = prepareRoute(restored.routes[restored.selectedRouteIndex]?.coords ?? []); }
    }
    this.loaded = true; this.state = { ...this.state }; this.emit();
  };
  flush = async (force = false) => {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.userId || (!this.loaded && !force)) return;
    const raw = this.state.destination ? JSON.stringify({ version: 1, userId: this.userId, state: this.state }) : null;
    this.writes = this.writes.catch(() => {}).then(() => raw ? this.storage.setItem(this.key(), raw) : this.storage.removeItem(this.key()));
    await this.writes.catch(() => {});
  };
  setDestination = (destination: NavigationPlace | null) => {
    if (destination && !validCoordinate(destination)) return;
    if (this.state.destination?.id === destination?.id && this.state.destination?.lat === destination?.lat && this.state.destination?.lng === destination?.lng) return;
    this.update({ assignedTripId: null, assignedTripVersion: null, assignedTripRevision: null, destination, routes: [], selectedRouteIndex: 0, tripActive: false, progress: emptyProgress(), error: null }, true);
  };
  beginCalculation = () => this.update({ calculating: true, error: null });
  finishCalculation = (routes: NavigationRoute[]) => this.update({ routes, selectedRouteIndex: 0,
    calculating: false, error: null, progress: emptyProgress() }, true);
  failCalculation = (message: string) => this.update({ calculating: false, error: message }, true);
  selectRoute = (selectedRouteIndex: number) => {
    if (!this.state.routes[selectedRouteIndex] || selectedRouteIndex === this.state.selectedRouteIndex) return;
    this.update({ selectedRouteIndex, progress: emptyProgress() }, true);
  };
  setTripActive = (tripActive: boolean) => {
    if (tripActive && (!this.state.destination || !this.state.routes.length || this.state.calculating)) return;
    this.update({ tripActive, followUser: tripActive || this.state.followUser }, true);
  };
  bindTrip = (assignedTripId: number | null, assignedTripVersion?: string | null, assignedTripRevision?: number | null) =>
    this.update({ assignedTripId, assignedTripVersion: assignedTripVersion ?? null, assignedTripRevision: assignedTripRevision ?? null }, true);
  setFollowUser = (followUser: boolean) => { if (followUser !== this.state.followUser) this.update({ followUser }); };
  setCamera = (camera: NavigationCamera) => {
    if (!validCoordinate({ lat: camera.latitude, lng: camera.longitude }) || !Number.isFinite(camera.latitudeDelta)
      || !Number.isFinite(camera.longitudeDelta) || camera.latitudeDelta <= 0 || camera.longitudeDelta <= 0) return;
    this.update({ camera });
  };
  updateFix = (fix: NavigationFix) => {
    if (!this.state.tripActive) return;
    const progress = advanceRouteProgress(this.geometry, fix, this.state.progress);
    if (progress !== this.state.progress) this.update({ progress });
  };
  clear = async () => {
    this.update(emptyNavigationSession(), true);
    await this.flush(true);
  };
  dispose = () => { if (this.timer) clearTimeout(this.timer); this.timer = undefined; };
}
