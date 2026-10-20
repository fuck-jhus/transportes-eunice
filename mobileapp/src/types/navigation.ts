import type { PositionFix } from '../utils/navigationTelemetry';
export interface NavigationTarget { id: string; name: string; lat: number; lng: number; tripId?: number; tripRevision?: number }

export interface NavigationPlace {
  id: string; name: string; address: string; lat: number; lng: number; timestamp: number;
  distanceKm?: number; isFavorite?: boolean; isPredefinedRoute?: boolean; placeType?: string; icon?: string;
}
export interface NavigationStep {
  name: string; distance: number; type: string; modifier?: string; instruction: string;
  location: [number, number]; progressMeters?: number;
}
export interface NavigationRoute {
  id: number; distKm: number; durationMin: number; coords: number[][]; steps?: NavigationStep[];
}
export interface NavigationFix extends PositionFix { speedKmh: number; heading: number | null }
export interface RouteProgress {
  distanceMeters: number; segmentIndex: number; timestamp: number; offRouteCount: number;
  matched: boolean; point: { lat: number; lng: number } | null; bearing: number | null;
}
export interface NavigationCamera { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }
export interface NavigationSession {
  assignedTripId?: number | null;
  assignedTripVersion?: string | null;
  assignedTripRevision?: number | null;
  destination: NavigationPlace | null; routes: NavigationRoute[]; selectedRouteIndex: number; tripActive: boolean;
  progress: RouteProgress; followUser: boolean; camera: NavigationCamera | null; updatedAt: number;
  calculating: boolean; error: string | null;
}
