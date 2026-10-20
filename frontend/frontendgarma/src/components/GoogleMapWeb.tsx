import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';
import { animateMarkerPosition, stopMarkerMotion } from '../utils/markerMotion';
import { getAdminMapStyles } from '../styles/mapStyles';
import { ArrowLeft, BookmarkPlus, BusFront, ChevronDown, LoaderCircle, LocateFixed, ScanSearch, Search, X } from 'lucide-react';
import {
  DEFAULT_CENTER,
  GUATEMALA_HIGHWAY_HUBS,
  escapeHtml,
  formatDuration,
  getDistanceKm,
  hasValidCoordinates,
  sanitizeRouteCoordinates,
  toLatLngTuple,
} from '../utils/mapSupport';
import type {
  BusMarker,
  BusMarkerData,
  GeocodingResult,
  GoogleMapWebProps,
  RouteOption,
  RoutingResult,
  SavedLocation,
} from '../utils/mapSupport';

const MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';


export const GoogleMapWeb: React.FC<GoogleMapWebProps> = ({
  buses = [],
  selectedBusPlaca,
  onSelectBus,
  userRole = 'Piloto',
  activeLiveRoutePlaca,
  onToggleLiveRoute,
  privacyBusesList = [],
  theme = 'light',
  onNotify,
  pilotTracking,
  onPilotNavigationChange,
  activeTripId,
  activeTripRouteName,
  onSavePilotRoute,
}) => {
  const isPilot = userRole === 'Piloto';
  const usesExternalPilotTracking = isPilot && pilotTracking !== undefined;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const busMarkersRef = useRef<Record<string, BusMarker>>({});
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const adminRouteLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const lastFittedRoutePlacaRef = useRef<string | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const hasAutoCenteredBusRef = useRef<boolean>(false);
  const hasAutoCenteredUserRef = useRef<boolean>(false);
  const lastReverseGeocodeRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const gpsErrorRef = useRef<number | null>(null);
  const routeRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const adminRouteCacheRef = useRef<{ placa: string; sLat: number; sLng: number; dLat: number; dLng: number; at: number } | null>(null);
  const notifyRef = useRef(onNotify);

  // Estados del Mapa y Tema
  const [mapThemeOverride, setMapThemeOverride] = useState<'dark' | 'light' | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const mapTheme = mapThemeOverride ?? theme;

  const isDark = mapTheme === 'dark';

  useEffect(() => {
    notifyRef.current = onNotify;
  }, [onNotify]);

  const {
    adminMapContainerWrapperStyle,
    adminHeaderControlStyle,
    adminFleetSelectorBtnStyle,
    adminUserBadgeLocationStyle,
    adminGpsPendingStyle,
    adminRecenterBtnStyle,
    adminUserLocationBtnStyle,
    adminMapElementStyle,
    adminModalOverlayStyle,
    adminModalCardStyle,
    adminCloseModalBtnStyle,
    adminSearchInputStyle,
    adminFleetListContainerStyle,
    adminBusCardItemStyle,
    adminFocusBusBtnStyle,
  } = getAdminMapStyles(isDark);

  const [localUserLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [userAddress, setUserAddress] = useState<string>('Tu ubicación actual');
  const [localGpsStatus, setGpsStatus] = useState<string>(() =>
    navigator.geolocation ? 'Obteniendo ubicación GPS...' : 'Navegador no soporta geolocalización'
  );
  const [localGpsState, setGpsState] = useState<'locating' | 'active' | 'unavailable'>(() =>
    navigator.geolocation ? 'locating' : 'unavailable'
  );
  const [localGpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const userLocation = usesExternalPilotTracking ? pilotTracking?.location ?? null : localUserLocation;
  const gpsAccuracy = usesExternalPilotTracking ? pilotTracking?.accuracy ?? null : localGpsAccuracy;
  const gpsStatus = usesExternalPilotTracking ? pilotTracking?.statusText ?? 'Buscando señal GPS' : localGpsStatus;
  const gpsState: 'locating' | 'active' | 'unavailable' = usesExternalPilotTracking
    ? pilotTracking?.phase === 'tracking'
      ? 'active'
      : pilotTracking?.phase === 'locating'
        ? 'locating'
        : 'unavailable'
    : localGpsState;

  // Modales y Búsqueda de Destinos
  const [showPlanModal, setShowPlanModal] = useState<boolean>(false);
  const [showFleetModal, setShowFleetModal] = useState<boolean>(false);
  const [fleetSearchFilter, setFleetSearchFilter] = useState<string>('');
  const [isPinSelectMode, setIsPinSelectMode] = useState<boolean>(false);
  const [destinationSearch, setDestinationSearch] = useState<string>('');
  const [searchSuggestions, setSearchSuggestions] = useState<SavedLocation[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState<boolean>(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchRequestRef.current += 1;
    routeRequestRef.current += 1;
  }, []);

  // Rutas Activas (Solo Piloto)
  const [selectedDestination, setSelectedDestination] = useState<SavedLocation | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [showSaveRouteModal, setShowSaveRouteModal] = useState(false);
  const [routeSaveName, setRouteSaveName] = useState('');
  const [isSavingRoute, setIsSavingRoute] = useState(false);

  // ESTADOS DE CICLO DE VIAJE (PILOTO)
  const [isTripActive, setIsTripActive] = useState<boolean>(false);
  const [showCancelTripModal, setShowCancelTripModal] = useState<boolean>(false);

  // Desduplicar y validar autobuses con GPS activo (ocultar de inmediato si están en modo privacidad o sin coordenadas)
  const uniqueBuses = useMemo(() => {
    const map = new Map<string, BusMarkerData>();
    buses.forEach((b) => {
      if (
        b &&
        b.placaAutobus &&
        !b.isPrivacyMode &&
        hasValidCoordinates(b.latitud, b.longitud)
      ) {
        map.set(b.placaAutobus, b);
      }
    });
    return Array.from(map.values());
  }, [buses]);

  // Geolocalización Inversa
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await api.get('/mapas/reversa', { params: { lat, lng } });
      if (res.data && res.data.address) {
        const a = res.data.address;
        const street = a.road || a.pedestrian || a.footway || a.building || '';
        const zone = a.neighbourhood || a.suburb || a.quarter || '';
        const city = a.city || a.town || a.village || 'Guatemala';
        const parts = [street, zone, city].filter(Boolean);
        if (parts.length > 0) {
          setUserAddress(parts.join(', '));
          return;
        }
      }
    } catch {
      // Ignorar fallback
    }
    setUserAddress('Tu ubicación actual');
  };

  // El piloto comparte un único lector GPS a nivel de aplicación. Así la transmisión
  // no se interrumpe al cambiar del mapa al historial o al chat.
  const externalPilotLocation = pilotTracking?.location;
  useEffect(() => {
    if (!usesExternalPilotTracking || !externalPilotLocation
      || !hasValidCoordinates(externalPilotLocation.lat, externalPilotLocation.lng)) return;
    if (userMarkerRef.current) animateMarkerPosition(userMarkerRef.current, [externalPilotLocation.lat, externalPilotLocation.lng]);

    const lastGeocode = lastReverseGeocodeRef.current;
    const now = Date.now();
    if (!lastGeocode
      || now - lastGeocode.at > 60_000
      || getDistanceKm(lastGeocode.lat, lastGeocode.lng, externalPilotLocation.lat, externalPilotLocation.lng) >= 0.2) {
      lastReverseGeocodeRef.current = { ...externalPilotLocation, at: now };
      void reverseGeocode(externalPilotLocation.lat, externalPilotLocation.lng);
    }
  }, [
    externalPilotLocation,
    usesExternalPilotTracking,
  ]);

  // Seguimiento GPS continuo en el navegador
  useEffect(() => {
    if (usesExternalPilotTracking || !navigator.geolocation) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        if (!hasValidCoordinates(coords.lat, coords.lng)) return;
        setUserLocation(coords);
        setGpsAccuracy(Math.round(pos.coords.accuracy));
        setGpsState('active');
        setGpsStatus(`GPS activo · precisión ${Math.round(pos.coords.accuracy)} m`);
        gpsErrorRef.current = null;

        const lastGeocode = lastReverseGeocodeRef.current;
        const now = Date.now();
        if (!lastGeocode || now - lastGeocode.at > 60000 || getDistanceKm(lastGeocode.lat, lastGeocode.lng, coords.lat, coords.lng) >= 0.2) {
          lastReverseGeocodeRef.current = { ...coords, at: now };
          void reverseGeocode(coords.lat, coords.lng);
        }

        if (userMarkerRef.current) {
          animateMarkerPosition(userMarkerRef.current, [coords.lat, coords.lng]);
        }
      },
      (err) => {
        console.warn('GPS browser warning:', err.message);
        const status = err.code === err.PERMISSION_DENIED
          ? 'Permiso de ubicación desactivado'
          : err.code === err.POSITION_UNAVAILABLE
            ? 'Señal GPS no disponible'
            : 'GPS en espera';
        setGpsState('unavailable');
        setGpsStatus(status);
        if (gpsErrorRef.current !== err.code) {
          gpsErrorRef.current = err.code;
          notifyRef.current?.(
            err.code === err.PERMISSION_DENIED
              ? 'La ubicación está bloqueada. Habilítala en los permisos del navegador para centrar el mapa.'
              : 'No se pudo obtener una ubicación precisa. El mapa seguirá mostrando la flota.',
            'warning',
          );
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [usesExternalPilotTracking]);

  // Redimensionar e invalidar tamaño automáticamente ante foco, orientación,
  // teclado virtual o cambio de tamaño del contenedor.
  useEffect(() => {
    const handleResizeOrFocus = () => {
      if (leafletMapRef.current) {
        try {
          leafletMapRef.current.invalidateSize({ pan: false, debounceMoveend: true });
        } catch {
          // El mapa puede haberse desmontado durante el cambio de tamaño.
        }
      }
    };
    window.addEventListener('resize', handleResizeOrFocus);
    window.addEventListener('orientationchange', handleResizeOrFocus);
    window.addEventListener('focus', handleResizeOrFocus);
    document.addEventListener('visibilitychange', handleResizeOrFocus);
    window.visualViewport?.addEventListener('resize', handleResizeOrFocus);
    window.visualViewport?.addEventListener('scroll', handleResizeOrFocus);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      ro = new ResizeObserver(() => {
        handleResizeOrFocus();
      });
      ro.observe(mapContainerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResizeOrFocus);
      window.removeEventListener('orientationchange', handleResizeOrFocus);
      window.removeEventListener('focus', handleResizeOrFocus);
      document.removeEventListener('visibilitychange', handleResizeOrFocus);
      window.visualViewport?.removeEventListener('resize', handleResizeOrFocus);
      window.visualViewport?.removeEventListener('scroll', handleResizeOrFocus);
      if (ro) ro.disconnect();
    };
  }, [mapInstance]);

  // Inicializar Mapa Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || leafletMapRef.current) return;

    const initialCenter: L.LatLngTuple = [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
      center: initialCenter,
      zoom: 15,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
      scrollWheelZoom: true,
      boxZoom: true,
      keyboard: true,
    });

    map.attributionControl.setPrefix(false);
    tileLayerRef.current = L.tileLayer(MAP_TILE_URL, {
      maxZoom: 19,
      tileSize: 256,
      detectRetina: false,
      keepBuffer: 3,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: MAP_ATTRIBUTION,
    }).addTo(map);

    leafletMapRef.current = map;
    setMapInstance(map);
    routeLayerGroupRef.current = L.layerGroup().addTo(map);
    adminRouteLayerGroupRef.current = L.layerGroup().addTo(map);

    // Redimensionamiento forzado inmediato y escalonado para garantizar visualización sin cambio de pestaña
    const invalidateTimers: number[] = [];
    try {
      map.invalidateSize();
      [150, 400, 800].forEach((delay) => {
        invalidateTimers.push(window.setTimeout(() => leafletMapRef.current?.invalidateSize(), delay));
      });
    } catch {
      // Leaflet puede estar completando el montaje del contenedor.
    }

    return () => {
      invalidateTimers.forEach((timer) => window.clearTimeout(timer));
      if (userMarkerRef.current) stopMarkerMotion(userMarkerRef.current);
      Object.values(busMarkersRef.current).forEach(stopMarkerMotion);
      map.remove();
      leafletMapRef.current = null;
      tileLayerRef.current = null;
      routeLayerGroupRef.current = null;
      adminRouteLayerGroupRef.current = null;
      userMarkerRef.current = null;
      busMarkersRef.current = {};
    };
  }, []);

  useEffect(() => {
    tileLayerRef.current?.redraw();
  }, [mapTheme, mapInstance]);

  const toggleMapTheme = () => {
    setMapThemeOverride(mapTheme === 'dark' ? 'light' : 'dark');
  };

  // Marcador de Usuario
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !userLocation) return;

    const userHtml = `
      <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
        <div style="position: absolute; width: 36px; height: 36px; background: rgba(37, 99, 235, 0.35); border-radius: 50%;"></div>
        <div style="width: 18px; height: 18px; background: #2563eb; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 12px #2563eb; position: relative; z-index: 2;"></div>
      </div>
    `;

    const userIcon = L.divIcon({
      className: 'custom-web-pin',
      html: userHtml,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    if (userMarkerRef.current) {
      animateMarkerPosition(userMarkerRef.current, [userLocation.lat, userLocation.lng]);
    } else {
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
    }

    // Centrar automáticamente en la ubicación del usuario si no hay autobuses activos aún
    if (!hasAutoCenteredBusRef.current && !hasAutoCenteredUserRef.current && uniqueBuses.length === 0) {
      hasAutoCenteredUserRef.current = true;
      try {
        map.setView([userLocation.lat, userLocation.lng], 16, { animate: true });
        map.invalidateSize();
      } catch {
        // El contenedor puede cambiar de tamaño mientras se centra.
      }
    }
  }, [userLocation, mapInstance, uniqueBuses.length]);

  // Marcadores de Flota de Autobuses
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const activePlacas = new Set(uniqueBuses.map((b) => b.placaAutobus));
    Object.keys(busMarkersRef.current).forEach((placa) => {
      if (!activePlacas.has(placa)) {
        stopMarkerMotion(busMarkersRef.current[placa]);
        map.removeLayer(busMarkersRef.current[placa]);
        delete busMarkersRef.current[placa];
      }
    });

    // Auto-centrar en el primer autobús o ajustar a toda la flota activa en la primera recepción de telemetría
    if (uniqueBuses.length > 0 && !hasAutoCenteredBusRef.current) {
      hasAutoCenteredBusRef.current = true;
      try {
        if (uniqueBuses.length === 1) {
          map.setView([uniqueBuses[0].latitud, uniqueBuses[0].longitud], 16, { animate: true });
        } else {
          const bounds = L.latLngBounds([]);
          uniqueBuses.forEach((b) => bounds.extend([b.latitud, b.longitud]));
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
          }
        }
        map.invalidateSize();
      } catch {
        // El contenedor puede cambiar de tamaño mientras se ajusta la flota.
      }
    }

    uniqueBuses.forEach((bus) => {
      const spdColor = bus.velocidadKmh > 80 ? '#ef4444' : bus.velocidadKmh > 50 ? '#f59e0b' : '#10b981';
      const isSelected = selectedBusPlaca === bus.placaAutobus;
      const safePlate = escapeHtml(bus.placaAutobus);
      const safePilot = escapeHtml(bus.nombrePiloto || 'Piloto');
      const safeRoute = escapeHtml(
        bus.nombreRuta && bus.nombreRuta !== 'N/D' && bus.nombreRuta !== 'Sin Ruta Asignada'
          ? bus.nombreRuta
          : 'Sin ruta asignada'
      );
      const hasLiveRoute = Boolean(bus.isTripActive && hasValidCoordinates(bus.destinoLat, bus.destinoLng));

      const busHtml = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
        ">
          <div style="
            width: 36px;
            height: 36px;
            background: ${spdColor};
            border: 2.5px solid ${isSelected ? '#38bdf8' : '#ffffff'};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            transition: transform 0.2s ease;
          ">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff">
              <path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/>
            </svg>
          </div>
          <div style="
            background: #18181b;
            color: #ffffff;
            padding: 2px 7px;
            border-radius: 8px;
            font-size: 10px;
            font-weight: 800;
            margin-top: 3px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          ">
            ${safePlate} • ${bus.velocidadKmh} km/h
          </div>
        </div>
      `;

      const busIcon = L.divIcon({
        className: 'custom-web-pin',
        html: busHtml,
        iconSize: [120, 56],
        iconAnchor: [60, 28],
      });

      const popupHtml = `
        <div class="fleet-map-popup" style="font-family: sans-serif; padding: 6px; color: #1e293b; min-width: 240px;">
          <h4 style="margin: 0 0 4px 0; font-size: 1rem; font-weight: 900; color: #0f172a;">Autobús: ${safePlate}</h4>
          <p style="margin: 3px 0; font-size: 0.85rem; color: #2563eb; font-weight: 800;">Piloto: ${safePilot}</p>
          <p style="margin: 3px 0; font-size: 0.85rem; color: #475569;">Ruta: <strong>${safeRoute}</strong></p>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin: 6px 0;">
            <span style="font-weight: 800; color: ${spdColor}; font-size: 0.85rem;">${bus.velocidadKmh} km/h</span>
            <button
              ${hasLiveRoute ? 'data-route-toggle="true"' : 'disabled'}
              style="
                background: ${activeLiveRoutePlaca === bus.placaAutobus ? '#ef4444' : (hasLiveRoute ? '#2563eb' : '#64748b')};
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 4px 10px;
                font-size: 0.75rem;
                font-weight: 800;
                cursor: ${hasLiveRoute ? 'pointer' : 'default'};
                opacity: ${hasLiveRoute ? '1' : '0.65'};
                pointer-events: ${hasLiveRoute ? 'auto' : 'none'};
                box-shadow: ${hasLiveRoute ? '0 2px 6px rgba(0,0,0,0.3)' : 'none'};
              "
            >
              ${activeLiveRoutePlaca === bus.placaAutobus ? 'Dejar de ver ruta' : (hasLiveRoute ? 'Ver ruta' : 'Sin ruta activa')}
            </button>
          </div>

          <div style="background: #f1f5f9; padding: 6px; border-radius: 8px; font-size: 0.75rem; margin: 6px 0;">
            <div>Giroscopio: X: ${(bus.giroscopioX ?? 0).toFixed(2)} | Y: ${(bus.giroscopioY ?? 0).toFixed(2)} | Z: ${(bus.giroscopioZ ?? 0).toFixed(2)}</div>
            <div>Aceleración: X: ${(bus.aceleracionX ?? 0).toFixed(2)} | Y: ${(bus.aceleracionY ?? 0).toFixed(2)} | Z: ${(bus.aceleracionZ ?? 9.8).toFixed(2)}</div>
          </div>
          <p style="margin: 4px 0 0 0; font-size: 0.75rem; color: #64748b; font-family: monospace;">GPS: ${Number(bus.latitud).toFixed(5)}, ${Number(bus.longitud).toFixed(5)}</p>
        </div>
      `;

      const bindPopupRouteAction = (marker: BusMarker) => {
        if (marker.__routeToggleHandler) {
          marker.off('popupopen', marker.__routeToggleHandler);
        }
        const routeToggleHandler = (event: L.PopupEvent) => {
          const button = event.popup?.getElement()?.querySelector('[data-route-toggle="true"]');
          button?.addEventListener('click', () => onToggleLiveRoute?.(bus.placaAutobus), { once: true });
        };
        marker.__routeToggleHandler = routeToggleHandler;
        marker.on('popupopen', routeToggleHandler);
      };

      if (busMarkersRef.current[bus.placaAutobus]) {
        const marker = busMarkersRef.current[bus.placaAutobus];
        animateMarkerPosition(marker, [bus.latitud, bus.longitud]);
        marker.setIcon(busIcon);
        marker.setPopupContent(popupHtml);
        bindPopupRouteAction(marker);
      } else {
        const marker = L.marker([bus.latitud, bus.longitud], { icon: busIcon, zIndexOffset: 500 }).addTo(map);
        marker.bindPopup(popupHtml);
        bindPopupRouteAction(marker);
        marker.on('click', () => {
          if (onSelectBus) onSelectBus(bus.placaAutobus);
        });
        busMarkersRef.current[bus.placaAutobus] = marker;
      }
    });
  }, [uniqueBuses, selectedBusPlaca, onSelectBus, onToggleLiveRoute, activeLiveRoutePlaca, mapInstance]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !selectedBusPlaca) return;
    const marker = busMarkersRef.current[selectedBusPlaca];
    if (!marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { animate: true, duration: 0.55 });
    marker.openPopup();
  }, [selectedBusPlaca, mapInstance]);

  // TRAZADO DE RUTA EN TIEMPO REAL PARA EL SUPERADMIN (VER RUTA / DEJAR DE VER RUTA)
  useEffect(() => {
    const map = leafletMapRef.current;
    const layerGroup = adminRouteLayerGroupRef.current;
    if (!map || !layerGroup) return;

    if (!activeLiveRoutePlaca) {
      layerGroup.clearLayers();
      lastFittedRoutePlacaRef.current = null;
      return;
    }

    const targetBus = uniqueBuses.find((b) => b.placaAutobus === activeLiveRoutePlaca) ||
      (privacyBusesList || []).find((b) => b.placaAutobus === activeLiveRoutePlaca);

    if (!targetBus) {
      layerGroup.clearLayers();
      lastFittedRoutePlacaRef.current = null;
      return;
    }

    // Si la unidad o piloto NO tiene un destino establecido desde la app móvil, NO trazar ninguna ruta arbitraria ni preestablecida
    const hasActiveNavDestination = Boolean(
      targetBus.isTripActive &&
      hasValidCoordinates(targetBus.destinoLat, targetBus.destinoLng) &&
      hasValidCoordinates(targetBus.latitud, targetBus.longitud) &&
      targetBus.destinoNombre &&
      targetBus.destinoNombre !== 'N/D' &&
      targetBus.destinoNombre !== 'Sin Ruta Asignada'
    );

    if (!hasActiveNavDestination) {
      layerGroup.clearLayers();
      lastFittedRoutePlacaRef.current = null;
      return;
    }

    // 1. Origen: Ubicación GPS real actual del vehículo en tiempo real
    const sLat = Number(targetBus.latitud);
    const sLng = Number(targetBus.longitud);
    const sName = targetBus.origenNombre || `Unidad ${targetBus.placaAutobus} (Ubicación Actual)`;

    // 2. Destino: El destino real configurado por el piloto en su app móvil
    const dLat = Number(targetBus.destinoLat);
    const dLng = Number(targetBus.destinoLng);
    const dName = targetBus.destinoNombre || 'Destino de Navegación';
    const previousRoute = adminRouteCacheRef.current;
    const destinationChanged = !previousRoute
      || previousRoute.placa !== targetBus.placaAutobus
      || previousRoute.dLat !== dLat
      || previousRoute.dLng !== dLng;
    const movedKm = previousRoute
      ? getDistanceKm(previousRoute.sLat, previousRoute.sLng, sLat, sLng)
      : Number.POSITIVE_INFINITY;
    if (!destinationChanged && movedKm < 0.08 && Date.now() - previousRoute.at < 15000) return;
    adminRouteCacheRef.current = { placa: targetBus.placaAutobus, sLat, sLng, dLat, dLng, at: Date.now() };
    let cancelled = false;

    // Consultar ruta OSRM vial completa de Inicio a Fin
    const drawAdminLiveRoute = async () => {
      try {
        let coords: L.LatLngTuple[] = [];
        let distKm = 0;
        let durMin = 0;

        // Intento 1: OSRM con continue_straight y steps entre Origen y Destino
        try {
          const res = await api.get('/mapas/ruta', {
            params: { puntos: `${sLng},${sLat};${dLng},${dLat}`, alternativas: false },
          });
          if (res.data && res.data.routes && res.data.routes.length > 0) {
            const r = res.data.routes[0];
            const rawCoords = r.geometry.coordinates.map(toLatLngTuple);
            const steps = r.legs && r.legs[0] && r.legs[0].steps ? r.legs[0].steps : [];
            coords = sanitizeRouteCoordinates(steps, rawCoords);
            distKm = Number((r.distance / 1000).toFixed(1));
            durMin = Math.max(1, Math.round(r.duration / 60));
          }
        } catch {
          // Se usa el proveedor alternativo de rutas.
        }

        // Intento 2: Fallback BRouter Car-Fast
        if (coords.length === 0) {
          try {
            const bRes = await api.get('/mapas/ruta-alternativa', {
              params: { puntos: `${sLng},${sLat}|${dLng},${dLat}` },
            });
            if (bRes.data && bRes.data.features && bRes.data.features.length > 0) {
              const feat = bRes.data.features[0];
              coords = feat.geometry.coordinates.map(toLatLngTuple);
              const props = feat.properties || {};
              distKm = Number(((props['total-length'] || 4800) / 1000).toFixed(1));
              durMin = Math.max(1, Math.round((props['total-time'] || 840) / 60));
            }
          } catch {
            // Se usará una línea directa como último recurso.
          }
        }

        // Intento 3: Conexión directa entre la ubicación actual de la unidad y el destino establecido
        if (coords.length === 0) {
          coords = [
            [sLat, sLng],
            [dLat, dLng]
          ];
          distKm = Number(getDistanceKm(sLat, sLng, dLat, dLng).toFixed(1));
          durMin = Math.max(1, Math.round(distKm * 2.5));
        }

        if (!cancelled && coords.length > 0) {
          layerGroup.clearLayers();

          // Fondo oscuro de la polilínea (Borde exterior)
          L.polyline(coords, {
            color: '#0b297a',
            weight: 10,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(layerGroup);

          // Línea azul rey oficial (Núcleo)
          L.polyline(coords, {
            color: 'var(--focus)',
            weight: 6,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(layerGroup);

          const currentSpd = Number(targetBus.velocidadKmh || 0);
          const safeStartName = escapeHtml(sName);
          const safeStartLabel = escapeHtml(targetBus.placaAutobus || sName);
          const safeDestinationName = escapeHtml(dName);

          // 1. Marcador del Autobús Original en Inicio de Ruta (Color Verde Esmeralda)
          const startPinHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));">
              <div style="
                width: 38px;
                height: 38px;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                border: 2.5px solid #ffffff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 14px rgba(16, 185, 129, 0.6);
              ">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="#ffffff">
                  <path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/>
                </svg>
              </div>
              <div style="
                background: #0f172a;
                color: #ffffff;
                padding: 3px 8px;
                border-radius: 8px;
                font-size: 10px;
                font-weight: 800;
                margin-top: 4px;
                border: 1px solid rgba(16, 185, 129, 0.4);
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                display: flex;
                align-items: center;
                gap: 5px;
              ">
                <span style="background: #10b981; color: #ffffff; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 900;">UNIDAD</span>
                <span title="${safeStartName}">${safeStartLabel} • ${currentSpd} km/h</span>
              </div>
            </div>
          `;
          const startIcon = L.divIcon({
            className: 'custom-web-pin',
            html: startPinHtml,
            iconSize: [160, 60],
            iconAnchor: [80, 30],
          });
          L.marker([sLat, sLng], { icon: startIcon, zIndexOffset: 2100 }).addTo(layerGroup);

          // 2. Marcador de Destino / Llegada (Pin de Navegación Profesional SVG)
          const destPinHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));">
              <div style="
                width: 38px;
                height: 38px;
                background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
                border: 2.5px solid #ffffff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 14px rgba(239, 68, 68, 0.6);
              ">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="#ffffff">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
              </div>
              <div style="
                background: #0f172a;
                color: #ffffff;
                padding: 3px 8px;
                border-radius: 8px;
                font-size: 10px;
                font-weight: 800;
                margin-top: 4px;
                border: 1px solid rgba(239, 68, 68, 0.4);
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                display: flex;
                align-items: center;
                gap: 5px;
              ">
                <span style="background: #ef4444; color: #ffffff; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 900;">LLEGADA</span>
                <span>${safeDestinationName} • ${distKm} km (${durMin} min)</span>
              </div>
            </div>
          `;
          const destIcon = L.divIcon({
            className: 'custom-web-pin',
            html: destPinHtml,
            iconSize: [180, 60],
            iconAnchor: [90, 30],
          });
          L.marker([dLat, dLng], { icon: destIcon, zIndexOffset: 2200 }).addTo(layerGroup);

          // Ajustar encuadre para mostrar la ruta completa de Inicio a Fin
          if (lastFittedRoutePlacaRef.current !== activeLiveRoutePlaca) {
            const bounds = L.latLngBounds(coords);
            map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15 });
            lastFittedRoutePlacaRef.current = activeLiveRoutePlaca;
          }
        }
      } catch (err) {
        console.warn('Error trazando ruta completa para admin:', err);
      }
    };

    void drawAdminLiveRoute();
    return () => {
      cancelled = true;
    };
  }, [activeLiveRoutePlaca, uniqueBuses, privacyBusesList]);

  // TRAZADO DE RUTAS EN AZUL REY + RUTAS ALTERNAS CON BORDES AZULES Y CENTRO TRANSLÚCIDO (SOLO PILOTO)
  const drawRouteOnMap = async (destLat: number, destLng: number, destName: string) => {
    const requestId = ++routeRequestRef.current;
    const origLat = userLocation?.lat ?? DEFAULT_CENTER.lat;
    const origLng = userLocation?.lng ?? DEFAULT_CENTER.lng;

    setIsCalculatingRoute(true);
    setRouteError(null);
    const candidates: { distKm: number; durationMin: number; coords: L.LatLngTuple[] }[] = [];

    // OSRM Direct con sanitización de esquinas
    try {
      const res = await api.get('/mapas/ruta', {
        params: { puntos: `${origLng},${origLat};${destLng},${destLat}`, alternativas: true },
      });
      if (res.data && res.data.routes) {
        res.data.routes.forEach((r: RoutingResult) => {
          const rawCoords = r.geometry.coordinates.map(toLatLngTuple);
          const steps = r.legs && r.legs[0] && r.legs[0].steps ? r.legs[0].steps : [];
          candidates.push({
            distKm: Number((r.distance / 1000).toFixed(1)),
            durationMin: Math.max(1, Math.round(r.duration / 60)),
            coords: sanitizeRouteCoordinates(steps, rawCoords),
          });
        });
      }
    } catch {
      // Fallback
    }

    // BRouter Car-Fast
    try {
      const bRes = await api.get('/mapas/ruta-alternativa', {
        params: { puntos: `${origLng},${origLat}|${destLng},${destLat}` },
      });
      if (bRes.data && bRes.data.features && bRes.data.features.length > 0) {
        const feat = bRes.data.features[0];
        const rawCoords = feat.geometry.coordinates.map(toLatLngTuple);
        const props = feat.properties || {};
        candidates.push({
          distKm: Number(((props['total-length'] || 1000) / 1000).toFixed(1)),
          durationMin: Math.max(1, Math.round((props['total-time'] || 60) / 60)),
          coords: rawCoords,
        });
      }
    } catch {
      // La ruta principal continúa disponible si falla el proveedor alternativo.
    }

    // Corredores viales
    const directDist = getDistanceKm(origLat, origLng, destLat, destLng);
    if (directDist > 30) {
      const hubs = GUATEMALA_HIGHWAY_HUBS.filter((hub) => {
        const d1 = getDistanceKm(origLat, origLng, hub.lat, hub.lng);
        const d2 = getDistanceKm(destLat, destLng, hub.lat, hub.lng);
        return d1 + d2 < directDist * 1.8 && d1 > 15 && d2 > 15;
      }).slice(0, 2);

      const promises = hubs.map(async (hub) => {
        try {
          const hRes = await api.get('/mapas/ruta', {
            params: {
              puntos: `${origLng},${origLat};${hub.lng},${hub.lat};${destLng},${destLat}`,
              alternativas: false,
            },
          });
          if (hRes.data && hRes.data.routes && hRes.data.routes.length > 0) {
            const r = hRes.data.routes[0];
            const rawCoords = r.geometry.coordinates.map(toLatLngTuple);
            const steps = r.legs && r.legs[0] && r.legs[0].steps ? r.legs[0].steps : [];
            candidates.push({
              distKm: Number((r.distance / 1000).toFixed(1)),
              durationMin: Math.max(1, Math.round(r.duration / 60)),
              coords: sanitizeRouteCoordinates(steps, rawCoords),
            });
          }
        } catch {
          // Ignorar
        }
      });
      await Promise.all(promises);
    }

    const unique: { distKm: number; durationMin: number; coords: L.LatLngTuple[] }[] = [];
    candidates.forEach((cand) => {
      const isDup = unique.some((ex) => Math.abs(ex.distKm - cand.distKm) < cand.distKm * 0.03 && Math.abs(ex.durationMin - cand.durationMin) < 3);
      if (!isDup && cand.coords.length > 2) unique.push(cand);
    });

    unique.sort((a, b) => a.durationMin - b.durationMin);
    const finalRoutes: RouteOption[] = unique.slice(0, 3).map((r, idx) => ({
      id: idx,
      distKm: r.distKm,
      durationMin: r.durationMin,
      coords: r.coords,
    }));

    if (routeRequestRef.current !== requestId) return;
    setIsCalculatingRoute(false);
    if (finalRoutes.length > 0) {
      setRouteInfo({ distanceKm: finalRoutes[0].distKm, durationMin: finalRoutes[0].durationMin });
      renderPolylinesOnLeaflet(finalRoutes, 0, destLat, destLng, destName, true);
    } else {
      setRouteInfo(null);
      setRouteError('No fue posible calcular una ruta vial');
      notifyRef.current?.('No se pudo calcular una ruta vial para ese destino. Intenta nuevamente.', 'error');
    }
  };

  // Renderizar rutas en Leaflet
  const renderPolylinesOnLeaflet = (
    routes: RouteOption[],
    selectedIdx: number,
    destLat: number,
    destLng: number,
    _destName: string,
    fitBounds: boolean
  ) => {
    const map = leafletMapRef.current;
    const routeLayerGroup = routeLayerGroupRef.current;
    if (!map || !routeLayerGroup) return;

    routeLayerGroup.clearLayers();
    const allBounds = L.latLngBounds([]);

    // 1. Dibujar Rutas Alternas (Bordes Azules + Centro Azul Translúcido)
    routes.forEach((r, idx) => {
      if (idx !== selectedIdx) {
        const altBg = L.polyline(r.coords, {
          color: '#2563eb',
          weight: 8.5,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeLayerGroup);

        const altFg = L.polyline(r.coords, {
          color: '#bfdbfe',
          weight: 4.8,
          opacity: 0.65,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeLayerGroup);

        const onSelect = () => {
          setRouteInfo({ distanceKm: r.distKm, durationMin: r.durationMin });
          renderPolylinesOnLeaflet(routes, idx, destLat, destLng, _destName, false);
        };

        altBg.on('click', onSelect);
        altFg.on('click', onSelect);

        if (r.coords.length > 2) {
          const midPoint = r.coords[Math.floor(r.coords.length * (0.35 + idx * 0.2))] || r.coords[Math.floor(r.coords.length / 2)];
          const altBubbleHtml = `
            <div style="
              background: #ffffff;
              color: #1e293b;
              padding: 6px 12px;
              border-radius: 12px;
              font-size: 12px;
              font-weight: 800;
              border: 1.5px solid #cbd5e1;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              cursor: pointer;
              white-space: nowrap;
            ">${formatDuration(r.durationMin)}</div>
          `;
          const altTimeIcon = L.divIcon({ className: 'custom-web-pin', html: altBubbleHtml, iconSize: [90, 32], iconAnchor: [45, 16] });
          const marker = L.marker(midPoint, { icon: altTimeIcon, zIndexOffset: 1200 }).addTo(routeLayerGroup);
          marker.on('click', onSelect);
        }

        allBounds.extend(r.coords);
      }
    });

    // 2. Dibujar Ruta Principal (Azul Rey Sólido con Borde Azul Marino Profundo)
    const main = routes[selectedIdx];
    if (main) {
      L.polyline(main.coords, {
        color: '#0b297a',
        weight: 10.5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeLayerGroup);

      L.polyline(main.coords, {
        color: 'var(--focus)',
        weight: 7,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeLayerGroup);

      if (main.coords.length > 1) {
        const midPoint = main.coords[Math.floor(main.coords.length * 0.5)];
        const mainBubbleHtml = `
          <div style="
            background: #1a56db;
            color: #ffffff;
            padding: 6px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 800;
            border: 1.5px solid #3b82f6;
            box-shadow: 0 4px 14px rgba(0,0,0,0.45);
            white-space: nowrap;
          ">${formatDuration(main.durationMin)}</div>
        `;
        const mainTimeIcon = L.divIcon({ className: 'custom-web-pin', html: mainBubbleHtml, iconSize: [96, 32], iconAnchor: [48, 16] });
        L.marker(midPoint, { icon: mainTimeIcon, zIndexOffset: 1800 }).addTo(routeLayerGroup);
      }

      allBounds.extend(main.coords);
    }

    // Marcador de Destino Rojo Oficial Google
    if (destMarkerRef.current) map.removeLayer(destMarkerRef.current);
    const redPinHtml = `
      <div style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6));">
        <svg viewBox="0 0 24 36" width="32" height="42">
          <path fill="#ea4335" stroke="#ffffff" stroke-width="1.2" d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12z"/>
          <circle fill="#ffffff" cx="12" cy="12" r="5.5"/>
          <circle fill="#b91c1c" cx="12" cy="12" r="3.2"/>
        </svg>
      </div>
    `;
    const redPinIcon = L.divIcon({ className: 'custom-web-pin', html: redPinHtml, iconSize: [32, 42], iconAnchor: [16, 42] });
    destMarkerRef.current = L.marker([destLat, destLng], { icon: redPinIcon, zIndexOffset: 2000 }).addTo(map);

    if (fitBounds && allBounds.isValid()) {
      map.fitBounds(allBounds, { padding: [40, 40], maxZoom: 16 });
    }
  };

  // Cancelar ruta
  const handleClearRoute = () => {
    routeRequestRef.current += 1;
    setSelectedDestination(null);
    setRouteInfo(null);
    setRouteError(null);
    setIsCalculatingRoute(false);
    setIsTripActive(false);
    onPilotNavigationChange?.(null);
    if (routeLayerGroupRef.current) routeLayerGroupRef.current.clearLayers();
    if (destMarkerRef.current && leafletMapRef.current) {
      leafletMapRef.current.removeLayer(destMarkerRef.current);
      destMarkerRef.current = null;
    }
  };

  // MANEJO DE INICIO Y CANCELACIÓN DE VIAJE (PILOTO)
  const handleStartTrip = () => {
    if (!userLocation) {
      notifyRef.current?.('El viaje iniciará sin ubicación local precisa hasta que el GPS esté disponible.', 'warning');
    }
    setIsTripActive(true);
    if (selectedDestination) {
      onPilotNavigationChange?.({
        lat: selectedDestination.lat,
        lng: selectedDestination.lng,
        name: selectedDestination.name,
      });
    }
  };

  const handleOpenSaveRoute = () => {
    if (!activeTripId) {
      notifyRef.current?.('Necesitas un viaje activo para guardar y asociar esta ruta.', 'warning');
      return;
    }
    if (!selectedDestination) return;
    const currentName = activeTripRouteName && !['N/D', 'Sin ruta asignada'].includes(activeTripRouteName)
      ? activeTripRouteName
      : `Ruta a ${selectedDestination.name}`;
    setRouteSaveName(currentName.slice(0, 100));
    setShowSaveRouteModal(true);
  };

  const handleSavePilotRoute = async () => {
    if (!selectedDestination || !onSavePilotRoute || !routeSaveName.trim()) return;
    setIsSavingRoute(true);
    try {
      await onSavePilotRoute({
        nombreRuta: routeSaveName.trim(),
        origen: (userAddress || 'Ubicación actual').slice(0, 100),
        destino: selectedDestination.name.slice(0, 100),
        ...(userLocation ? {
          origenLatitud: userLocation.lat,
          origenLongitud: userLocation.lng,
        } : {}),
        destinoLatitud: selectedDestination.lat,
        destinoLongitud: selectedDestination.lng,
      });
      setShowSaveRouteModal(false);
    } finally {
      setIsSavingRoute(false);
    }
  };

  const handlePressCancelTrip = () => {
    setShowCancelTripModal(true);
  };

  const handleConfirmCancelTrip = () => {
    setShowCancelTripModal(false);
    handleClearRoute();
    setTimeout(() => {
      handleCenterUser();
    }, 150);
  };

  const handleDismissCancelTrip = () => {
    setShowCancelTripModal(false);
  };

  // Centrar en el usuario
  const handleCenterUser = () => {
    if (userLocation && leafletMapRef.current) {
      leafletMapRef.current.setView([userLocation.lat, userLocation.lng], 16, { animate: true });
    } else {
      notifyRef.current?.('Aún no hay una ubicación disponible para centrar el mapa.', 'warning');
    }
  };

  // Re-centrar en toda la flota (SuperAdmin)
  const handleRecenterFlota = () => {
    const map = leafletMapRef.current;
    if (!map) return;

    if (uniqueBuses.length > 0) {
      const bounds = L.latLngBounds([]);
      uniqueBuses.forEach((b) => bounds.extend([b.latitud, b.longitud]));
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      map.setView(userLocation ? [userLocation.lat, userLocation.lng] : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 15);
    }
  };

  // Abrir Waze
  const handleOpenWaze = () => {
    if (!selectedDestination) return;
    const url = `https://waze.com/ul?ll=${selectedDestination.lat},${selectedDestination.lng}&navigate=yes`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Autocompletado de Búsqueda
  const handleSearchChange = (text: string) => {
    const requestId = ++searchRequestRef.current;
    setDestinationSearch(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!text.trim() || text.trim().length < 3) {
      setSearchSuggestions([]);
      setIsSearchingPlaces(false);
      return;
    }

    setIsSearchingPlaces(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const uLat = userLocation?.lat ?? DEFAULT_CENTER.lat;
        const uLng = userLocation?.lng ?? DEFAULT_CENTER.lng;
        const res = await api.get('/mapas/buscar', { params: { consulta: text.trim() } });

        if (res.data && Array.isArray(res.data)) {
          const suggestions: SavedLocation[] = res.data
            .map((item: GeocodingResult, idx: number) => ({
              id: `sug-${idx}-${Date.now()}`,
              name: item.name || item.display_name.split(',')[0],
              address: item.display_name,
              lat: Number.parseFloat(item.lat),
              lng: Number.parseFloat(item.lon),
              distanceKm: getDistanceKm(uLat, uLng, Number.parseFloat(item.lat), Number.parseFloat(item.lon)),
            }))
            .filter((item: SavedLocation) => hasValidCoordinates(item.lat, item.lng));
          suggestions.sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
          if (searchRequestRef.current === requestId) setSearchSuggestions(suggestions);
        }
      } catch {
        if (searchRequestRef.current === requestId) {
          setSearchSuggestions([]);
          notifyRef.current?.('No se pudo consultar destinos en este momento.', 'warning');
        }
      } finally {
        if (searchRequestRef.current === requestId) setIsSearchingPlaces(false);
      }
    }, 300);
  };

  const handleSelectPlace = (place: SavedLocation) => {
    setSelectedDestination(place);
    setShowPlanModal(false);
    setIsPinSelectMode(false);
    setSearchSuggestions([]);
    drawRouteOnMap(place.lat, place.lng, place.name);
  };

  const handleConfirmPin = () => {
    if (!leafletMapRef.current) return;
    const center = leafletMapRef.current.getCenter();
    const placeName = destinationSearch.trim() || `Destino Seleccionado (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)})`;
    const newPlace: SavedLocation = {
      id: `pin-${Date.now()}`,
      name: placeName,
      address: `Lat ${center.lat.toFixed(5)}, Lng ${center.lng.toFixed(5)}`,
      lat: center.lat,
      lng: center.lng,
    };
    handleSelectPlace(newPlace);
  };

  // Filtrado de autobuses en el modal de SuperAdmin
  const filteredBuses = uniqueBuses.filter((b) =>
    b.placaAutobus.toLowerCase().includes(fleetSearchFilter.toLowerCase()) ||
    b.nombrePiloto.toLowerCase().includes(fleetSearchFilter.toLowerCase()) ||
    (b.nombreRuta && b.nombreRuta.toLowerCase().includes(fleetSearchFilter.toLowerCase()))
  );

  const filteredPrivacyBuses = (privacyBusesList || []).filter(
    (b) =>
      b.placaAutobus.toLowerCase().includes(fleetSearchFilter.toLowerCase()) ||
      b.nombrePiloto.toLowerCase().includes(fleetSearchFilter.toLowerCase()) ||
      (b.nombreRuta && b.nombreRuta.toLowerCase().includes(fleetSearchFilter.toLowerCase()))
  );

  // -------------------------------------------------------------
  // RENDERIZADO CONDICIONAL POR ROL
  // -------------------------------------------------------------

  // VISTA 1: SUPERADMINISTRADOR / ADMINISTRADOR / SUPERVISOR (Mapa de Supervisión Original)
  if (!isPilot) {
    return (
      <div className={`map-surface map-theme-${mapTheme}`} style={adminMapContainerWrapperStyle}>
        {/* Barra de Controles Superior Original de Supervisión */}
        <div className="map-toolbar" style={adminHeaderControlStyle}>
          <div className="map-toolbar-status" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 720, color: 'var(--ink)' }}>
              Monitoreo en vivo
            </h3>

            {/* Botón Verde Original para Abrir el Selector de Flota y Pilotos */}
            <button
              className="map-fleet-trigger"
              type="button"
              onClick={() => setShowFleetModal(true)}
              style={adminFleetSelectorBtnStyle}
              title="Haz clic para ver y seleccionar los autobuses y pilotos asignados"
            >
              <BusFront size={14} />
              {uniqueBuses.length} {uniqueBuses.length === 1 ? 'autobús activo' : 'autobuses activos'}
              <ChevronDown size={14} />
            </button>

            {privacyBusesList && privacyBusesList.length > 0 && (
              <span className="map-unavailable-badge" style={{
                backgroundColor: isDark ? '#1f2937' : '#18181b',
                color: isDark ? '#cbd5e1' : '#d4d4d8',
                border: `1px solid ${isDark ? '#374151' : '#3f3f46'}`,
                borderRadius: '16px',
                padding: '6px 12px',
                fontSize: '0.82rem',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {privacyBusesList.length} {privacyBusesList.length === 1 ? 'unidad sin ubicación' : 'unidades sin ubicación'}
              </span>
            )}

            <span className={`map-gps-status is-${gpsState}`} title={gpsAccuracy ? `Precisión estimada: ${gpsAccuracy} metros` : undefined} style={userLocation ? adminUserBadgeLocationStyle : adminGpsPendingStyle}>
              {userLocation ? `${gpsStatus}` : `${gpsStatus}`}
            </span>
          </div>

          <div className="map-toolbar-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleCenterUser} style={adminUserLocationBtnStyle}>
              <LocateFixed size={15} /> Mi ubicación
            </button>

            <button type="button" onClick={handleRecenterFlota} style={adminRecenterBtnStyle}>
              <ScanSearch size={15} /> Centrar flota
            </button>
          </div>
        </div>

        {/* Contenedor del Mapa */}
        <div className="map-canvas-shell" style={adminMapElementStyle}>
          <div className="map-canvas" ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* MODAL ORIGINAL DE FLOTA Y SENSORES PARA SUPERADMIN */}
        {showFleetModal && (
          <div className="modal-overlay" style={adminModalOverlayStyle}>
            <div className="modal-card" role="dialog" aria-modal="true" style={adminModalCardStyle}>
              <div className="map-fleet-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 720, color: 'var(--ink)' }}>
                    Flota Activa y Sensores en Vivo
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: isDark ? '#94a3b8' : '#71717a' }}>
                    Lecturas satelitales de Giroscopio, Aceleración y Velocidad en tiempo real
                  </p>
                </div>
                <button aria-label="Cerrar" onClick={() => setShowFleetModal(false)} style={adminCloseModalBtnStyle}><X size={16} /></button>
              </div>

              {/* Buscador Rápido */}
              <div style={{ position: 'relative' }}>
                <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: '13px', top: '13px', color: 'var(--muted)', zIndex: 1 }} />
                <input
                  type="text"
                  aria-label="Buscar en la flota"
                  placeholder="Buscar por placa, piloto o ruta"
                  value={fleetSearchFilter}
                  onChange={(e) => setFleetSearchFilter(e.target.value)}
                  style={{ ...adminSearchInputStyle, paddingLeft: '38px' }}
                />
              </div>

              {/* Lista de Tarjetas de Autobuses con Sensores */}
              <div style={adminFleetListContainerStyle}>
                {filteredBuses.length === 0 && filteredPrivacyBuses.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#71717a', padding: '30px' }}>
                    No se encontraron autobuses que coincidan con la búsqueda.
                  </div>
                ) : (
                  <>
                    {filteredBuses.map((bus) => (
                      <div className="map-fleet-card" key={bus.placaAutobus} style={adminBusCardItemStyle}>
                        <div className="map-fleet-card-layout" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              
                              <strong style={{ fontSize: '1.05rem', color: '#18181b', fontWeight: 900 }}>
                                {bus.placaAutobus}
                              </strong>
                              <span style={{
                                fontSize: '0.75rem',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                color: '#10b981',
                                fontWeight: 800,
                              }}>
                                {bus.velocidadKmh} km/h
                              </span>
                              {(() => {
                                const hasNav = Boolean(bus.isTripActive && hasValidCoordinates(bus.destinoLat, bus.destinoLng));
                                return (
                                  <button
                                    type="button"
                                    disabled={!hasNav}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!hasNav) return;
                                      if (onToggleLiveRoute) onToggleLiveRoute(bus.placaAutobus);
                                      setShowFleetModal(false);
                                    }}
                                    style={{
                                      backgroundColor: activeLiveRoutePlaca === bus.placaAutobus ? '#ef4444' : (hasNav ? '#2563eb' : '#64748b'),
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: '8px',
                                      padding: '4px 10px',
                                      fontSize: '0.75rem',
                                      fontWeight: 800,
                                      cursor: hasNav ? 'pointer' : 'default',
                                      opacity: hasNav ? 1 : 0.65,
                                      pointerEvents: hasNav ? 'auto' : 'none',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      boxShadow: hasNav ? '0 2px 6px rgba(0,0,0,0.2)' : 'none'
                                    }}
                                  >
                                    {activeLiveRoutePlaca === bus.placaAutobus ? 'Dejar de ver ruta' : (hasNav ? 'Ver ruta' : 'Sin ruta activa')}
                                  </button>
                                );
                              })()}
                            </div>

                            <div style={{ margin: '6px 0 2px 0', fontSize: '0.9rem', color: '#2563eb', fontWeight: 800 }}>
                              Piloto: {bus.nombrePiloto}
                            </div>

                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                              Ruta: <strong>{(bus.nombreRuta && bus.nombreRuta !== 'N/D' && bus.nombreRuta !== 'Sin Ruta Asignada') ? bus.nombreRuta : 'Sin ruta asignada'}</strong>
                            </div>

                            <div style={{ marginTop: '8px', backgroundColor: '#ffffff', padding: '8px 10px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <div style={{ fontSize: '0.75rem', color: '#18181b' }}>
                                <strong>Giroscopio (rad/s):</strong> X: ${(bus.giroscopioX ?? 0).toFixed(2)} | Y: ${(bus.giroscopioY ?? 0).toFixed(2)} | Z: ${(bus.giroscopioZ ?? 0).toFixed(2)}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#18181b' }}>
                                <strong>Acelerómetro (G):</strong> X: ${(bus.aceleracionX ?? 0).toFixed(2)} | Y: ${(bus.aceleracionY ?? 0).toFixed(2)} | Z: ${(bus.aceleracionZ ?? 9.8).toFixed(2)}
                              </div>
                            </div>

                            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '6px', fontFamily: 'monospace' }}>
                              GPS: {bus.latitud.toFixed(5)}, {bus.longitud.toFixed(5)}
                            </div>
                          </div>

                          <button
                            className="map-focus-button"
                            type="button"
                            onClick={() => {
                              if (leafletMapRef.current) {
                                leafletMapRef.current.setView([bus.latitud, bus.longitud], 17, { animate: true });
                              }
                              if (onSelectBus) onSelectBus(bus.placaAutobus);
                              setShowFleetModal(false);
                            }}
                            style={adminFocusBusBtnStyle}
                          >
                            Enfocar en Mapa
                          </button>
                        </div>
                      </div>
                    ))}

                    {filteredPrivacyBuses.length > 0 && (
                      <>
                        <div style={{ fontSize: '0.85rem', fontWeight: 900, color: '#71717a', marginTop: '16px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Unidades sin ubicación disponible ({filteredPrivacyBuses.length})
                        </div>
                        {filteredPrivacyBuses.map((bus) => (
                          <div key={`priv-${bus.placaAutobus}`} style={{
                            ...adminBusCardItemStyle,
                            backgroundColor: '#18181b',
                            borderColor: '#3f3f46',
                            borderWidth: '1.5px',
                            color: '#ffffff'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  
                                  <strong style={{ fontSize: '1.05rem', color: '#ffffff', fontWeight: 900 }}>
                                    {bus.placaAutobus}
                                  </strong>
                                  <span style={{
                                    fontSize: '0.75rem',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    backgroundColor: '#27272a',
                                    color: '#e4e4e7',
                                    fontWeight: 800,
                                    border: '1px solid #52525b'
                                  }}>
                                    {bus.locationStatus === 'unavailable' ? 'GPS no disponible' : 'Modo privacidad'}
                                  </span>
                                </div>
                                <div style={{ margin: '6px 0 2px 0', fontSize: '0.9rem', color: '#93c5fd', fontWeight: 800 }}>
                                  Piloto: {bus.nombrePiloto}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
                                  Ruta: <strong>{bus.nombreRuta || 'Ruta Principal'}</strong>
                                </div>
                                <div style={{ marginTop: '8px', backgroundColor: '#27272a', padding: '8px 10px', borderRadius: '10px', border: '1px solid #3f3f46', fontSize: '0.78rem', color: '#d4d4d8' }}>
                                  {bus.locationStatus === 'unavailable' ? (
                                    <><strong>No hay una posición GPS válida.</strong> La unidad seguirá visible en el listado y volverá al mapa cuando reciba coordenadas.</>
                                  ) : (
                                    <><strong>El piloto desactivó su ubicación.</strong> No se emiten lecturas GPS ni se muestra el ícono en el mapa mientras la privacidad esté activa.</>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // VISTA 2: PILOTO (Mapa de Navegación con Rutas Oficiales, Alternas y Waze)
  return (
    <div className={`pilot-map-shell map-theme-${mapTheme}`} style={webContainerStyle}>
      {/* 1. BARRA SUPERIOR "¿A DÓNDE VAS?" CON ESTILO GOOGLE MAPS */}
      <div className="pilot-map-planner" style={topPlanningBarStyle}>
        {selectedDestination ? (
          <div className="pilot-active-route" style={activeRouteCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <div style={flagIconStyle}>•</div>
              <div>
                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#ffffff' }}>
                  {isTripActive ? `En Viaje: ${selectedDestination.name}` : `Ruta: ${selectedDestination.name}`}
                </h4>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700 }}>
                  {isCalculatingRoute ? 'Calculando ruta vial...' : routeInfo ? `${routeInfo.distanceKm} km · ${formatDuration(routeInfo.durationMin)} estimados (Mejor ruta)` : routeError || 'Ruta lista para calcular'}
                </p>
              </div>
            </div>
            <div className="pilot-route-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleOpenSaveRoute}
                disabled={isSavingRoute || !activeTripId}
                style={{ ...saveRouteBtnStyle, opacity: activeTripId ? 1 : 0.55 }}
                title="Guardar esta ruta y asociarla al viaje"
              >
                <BookmarkPlus size={14} /> Guardar ruta
              </button>
              {!isTripActive ? (
                <>
                  <button onClick={() => setShowPlanModal(true)} style={searchIconBtnStyle} title="Cambiar destino">Buscar</button>
                  <button onClick={handleClearRoute} style={cancelRouteBtnStyle} title="Cancelar ruta">
                    Cancelar Ruta
                  </button>
                  <button onClick={handleStartTrip} style={startTripBtnStyle} title="Iniciar viaje">
                    Iniciar navegación
                  </button>
                </>
              ) : (
                <button onClick={handlePressCancelTrip} style={cancelTripBtnActiveStyle} title="Detener navegación">
                  Detener navegación
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="pilot-destination-search" style={searchTripBarStyle} onClick={() => setShowPlanModal(true)}>
            <div style={searchSquareIconStyle}>
              <div style={searchInnerSquareStyle} />
            </div>
            <div style={{ flex: 1, cursor: 'pointer' }}>
              <div style={{ color: '#ffffff', fontSize: '0.95rem', fontWeight: 800 }}>¿A dónde vas?</div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>{userAddress}</div>
            </div>
            <button style={searchActionBtnStyle}>Buscar</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className={`map-gps-status is-${gpsState}`} title={gpsAccuracy ? `Precisión estimada: ${gpsAccuracy} metros` : undefined} style={{ fontSize: '0.75rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '6px 12px', borderRadius: '14px', border: '1px solid rgba(56, 189, 248, 0.2)', fontWeight: 700 }}>
            {gpsStatus}
          </span>
        </div>
      </div>

      {/* 2. CONTENEDOR DEL MAPA LEAFLET INTERACTIVO */}
      <div className="map-canvas-shell pilot-map-canvas-shell" style={mapViewContainerStyle}>
        <div className="map-canvas" ref={mapContainerRef} style={{ width: '100%', height: '100%', borderRadius: '20px' }} />

        {/* PIN FLOTANTE EN MODO 'FIJA TU DESTINO' */}
        {isPinSelectMode && (
          <div style={centerPinOverlayStyle}>
            <div style={targetPinHeadStyle}>
              <div style={targetPinInnerBlackStyle} />
            </div>
            <div style={pinStickStyle} />
            <div style={pinBlueBaseStyle} />
          </div>
        )}

        {/* BOTÓN FLOTANTE DÍA / NOCHE (INFERIOR IZQUIERDO) */}
        {!isPinSelectMode && (
          <button onClick={toggleMapTheme} style={floatingThemeBtnStyle} title="Cambiar tema Día / Noche">
            {mapTheme === 'dark' ? 'Día' : 'Noche'}
          </button>
        )}

        {/* BOTÓN FLOTANTE DE WAZE (SOLO DURANTE EL VIAJE ACTIVO) */}
        {!isPinSelectMode && isTripActive && selectedDestination && (
          <button onClick={handleOpenWaze} style={floatingWazeBtnStyle} title="Abrir navegación en Waze">
            <svg width="26" height="26" viewBox="0 0 48 48">
              <path
                d="M24 6C13.5 6 5 14.5 5 25c0 4.2 1.4 8.1 3.8 11.2L7 41.5c-.3.9.6 1.8 1.5 1.5l5.8-2C17.4 43 20.6 44 24 44c10.5 0 19-8.5 19-19S34.5 6 24 6z"
                fill="#FFFFFF"
              />
              <circle cx="18" cy="22" r="3.2" fill="#0b1120" />
              <circle cx="30" cy="22" r="3.2" fill="#0b1120" />
              <circle cx="19" cy="21" r="1.1" fill="#FFFFFF" />
              <circle cx="31" cy="21" r="1.1" fill="#FFFFFF" />
              <path d="M18 29c1.8 2.5 4.1 3.5 6 3.5s4.2-1 6-3.5" stroke="#0b1120" strokeWidth="2.8" strokeLinecap="round" fill="none" />
              <circle cx="12" cy="38" r="3.2" fill="#0b1120" />
              <circle cx="36" cy="38" r="3.2" fill="#0b1120" />
            </svg>
          </button>
        )}

        {/* BOTÓN CIRCULAR DE CENTRADO GPS (INFERIOR DERECHO) */}
        {!isPinSelectMode && (
          <button onClick={handleCenterUser} style={floatingCenterBtnStyle} title="Centrar en mi ubicación">
            <LocateFixed size={20} />
          </button>
        )}

        {/* BARRA INFERIOR EN MODO PIN */}
        {isPinSelectMode && (
          <div className="map-pin-toolbar" style={pinBottomBarStyle}>
            <button onClick={() => { setIsPinSelectMode(false); setShowPlanModal(true); }} style={pinBackBtnStyle}>
              <ArrowLeft size={18} />
            </button>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                placeholder="Nombre del destino (ej: Mi Destino)"
                value={destinationSearch}
                onChange={(e) => setDestinationSearch(e.target.value)}
                style={pinInputStyle}
              />
            </div>
            <button onClick={handleConfirmPin} style={pinConfirmBtnStyle}>
              Fijar Destino
            </button>
          </div>
        )}
      </div>

      {/* 3. MODAL "PLANIFICA TU VIAJE" */}
      {showPlanModal && (
        <div style={modalBackdropStyle}>
          <div className="map-plan-modal" style={modalPlanCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#ffffff' }}>
                Planifica tu viaje
              </h3>
              <button aria-label="Cerrar" onClick={() => setShowPlanModal(false)} style={modalCloseBtnStyle}><X size={17} /></button>
            </div>

            <div style={inputsContainerCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffffff' }} />
                <input
                  type="text"
                  value={userAddress}
                  disabled
                  style={disabledInputStyle}
                />
              </div>
              <div style={{ width: '2px', height: '18px', background: '#3f3f46', marginLeft: '4px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#ef4444' }} />
                <input
                  type="text"
                  placeholder="¿A dónde vas?"
                  value={destinationSearch}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  autoFocus
                  style={activeSearchInputStyle}
                />
                {isSearchingPlaces && <LoaderCircle className="map-search-spinner" size={17} aria-label="Buscando destinos" />}
              </div>
            </div>

            <button
              onClick={() => { setShowPlanModal(false); setIsPinSelectMode(true); }}
              style={pinModeTriggerBtnStyle}
            >
              Establecer ubicación en el mapa
            </button>

            {/* Sugerencias de Búsqueda */}
            <div style={{ overflowY: 'auto', maxHeight: '280px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {searchSuggestions.map((sug) => (
                <div
                  key={sug.id}
                  onClick={() => handleSelectPlace(sug)}
                  style={suggestionItemStyle}
                >
                  
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: '#ffffff', fontSize: '0.9rem' }}>{sug.name}</strong>
                    <div style={{ color: '#a1a1aa', fontSize: '0.75rem', marginTop: '2px' }}>{sug.address}</div>
                  </div>
                  {sug.distanceKm && (
                    <span style={{ color: '#ffffff', fontSize: '0.75rem', fontWeight: 800 }}>
                      {sug.distanceKm} km
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSaveRouteModal && selectedDestination && (
        <div style={modalBackdropStyle}>
          <div className="map-save-route-modal" style={{
            ...modalPlanCardStyle,
            maxWidth: '440px',
            background: isDark ? '#0f1929' : '#ffffff',
            borderColor: isDark ? '#253349' : '#dbe4e7',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ color: '#fb7a43', fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ruta frecuente</div>
                <h3 style={{ margin: '4px 0 0', color: isDark ? '#fff' : '#0f172a' }}>Guardar este recorrido</h3>
              </div>
              <button aria-label="Cerrar" onClick={() => setShowSaveRouteModal(false)} style={modalCloseBtnStyle}><X size={17} /></button>
            </div>
            <div style={{ background: isDark ? '#111c2e' : '#f8fafc', border: `1px solid ${isDark ? '#253349' : '#e2e8f0'}`, borderRadius: '16px', padding: '14px', marginBottom: '14px' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Desde</div>
              <strong style={{ color: isDark ? '#fff' : '#0f172a', display: 'block', marginBottom: '12px' }}>{userAddress}</strong>
              <div style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Hasta</div>
              <strong style={{ color: isDark ? '#fff' : '#0f172a' }}>{selectedDestination.name}</strong>
            </div>
            <label htmlFor="pilot-route-name" style={{ display: 'block', color: isDark ? '#cbd5e1' : '#334155', fontSize: '0.8rem', fontWeight: 700, marginBottom: '6px' }}>Nombre de la ruta</label>
            <input
              id="pilot-route-name"
              value={routeSaveName}
              maxLength={100}
              onChange={(event) => setRouteSaveName(event.target.value)}
              placeholder="Ej. Terminal - Centro"
              style={{ ...activeSearchInputStyle, background: isDark ? activeSearchInputStyle.background : '#f8fafc', color: isDark ? '#fff' : '#0f172a', borderColor: isDark ? '#334155' : '#cbd5e1' }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button type="button" onClick={() => setShowSaveRouteModal(false)} style={cancelRouteBtnStyle}>Cancelar</button>
              <button type="button" disabled={isSavingRoute || routeSaveName.trim().length < 2} onClick={() => void handleSavePilotRoute()} style={{ ...startTripBtnStyle, display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                {isSavingRoute ? <LoaderCircle className="map-search-spinner" size={15} /> : <BookmarkPlus size={15} />}
                {isSavingRoute ? 'Guardando...' : 'Guardar y asociar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. MODAL DE ADVERTENCIA: ¿ESTÁS SEGURO DE CANCELAR EL VIAJE? (WEB) */}
      {showCancelTripModal && (
        <div style={confirmModalBackdropStyle}>
          <div style={confirmModalCardStyle}>
            <div style={warningIconCircleStyle}>
              
            </div>
            <h3 style={confirmModalTitleStyle}>¿Deseas detener la navegación?</h3>
            <p style={confirmModalSubStyle}>
              Se ocultará la ruta guiada, pero el recorrido asignado continuará activo hasta que lo finalices.
            </p>
            <div style={confirmButtonsRowStyle}>
              <button onClick={handleDismissCancelTrip} style={keepTripBtnStyle}>
                Cancelar
              </button>
              <button onClick={handleConfirmCancelTrip} style={confirmCancelBtnStyle}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Estilos CSS (Piloto / Modo Oscuro) ---

const webContainerStyle: React.CSSProperties = {
  backgroundColor: '#0b1120',
  borderRadius: '24px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  width: '100%',
  boxSizing: 'border-box',
  color: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const topPlanningBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
};

const searchTripBarStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  backgroundColor: '#111c2e',
  borderRadius: '20px',
  padding: '10px 16px',
  border: '1px solid #1e293b',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
};

const searchSquareIconStyle: React.CSSProperties = {
  width: '26px',
  height: '26px',
  backgroundColor: '#0b1120',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: '12px',
};

const searchInnerSquareStyle: React.CSSProperties = {
  width: '10px',
  height: '10px',
  backgroundColor: '#38bdf8',
  borderRadius: '2px',
};

const searchActionBtnStyle: React.CSSProperties = {
  background: '#1e293b',
  border: 'none',
  borderRadius: '50%',
  width: '32px',
  height: '32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const activeRouteCardStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  backgroundColor: '#111c2e',
  borderRadius: '20px',
  padding: '10px 16px',
  border: '1px solid #1e293b',
};

const flagIconStyle: React.CSSProperties = {
  width: '30px',
  height: '30px',
  borderRadius: '8px',
  background: '#0b1120',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
};

const searchIconBtnStyle: React.CSSProperties = {
  background: '#1e293b',
  border: 'none',
  borderRadius: '50%',
  width: '32px',
  height: '32px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const cancelRouteBtnStyle: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.15)',
  border: '1px solid #ef4444',
  borderRadius: '16px',
  color: '#f87171',
  fontWeight: 800,
  fontSize: '0.8rem',
  padding: '6px 12px',
  cursor: 'pointer',
};

const startTripBtnStyle: React.CSSProperties = {
  background: '#10b981',
  border: 'none',
  borderRadius: '16px',
  color: '#ffffff',
  fontWeight: 900,
  fontSize: '0.8rem',
  padding: '6px 14px',
  cursor: 'pointer',
  boxShadow: '0 4px 10px rgba(16, 185, 129, 0.3)',
};

const saveRouteBtnStyle: React.CSSProperties = {
  background: 'rgba(251, 122, 67, 0.12)',
  border: '1px solid rgba(251, 122, 67, 0.5)',
  borderRadius: '16px',
  color: '#fb7a43',
  fontWeight: 850,
  fontSize: '0.78rem',
  padding: '7px 12px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const cancelTripBtnActiveStyle: React.CSSProperties = {
  background: '#ef4444',
  border: 'none',
  borderRadius: '16px',
  color: '#ffffff',
  fontWeight: 900,
  fontSize: '0.85rem',
  padding: '8px 16px',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)',
};

const mapViewContainerStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '560px',
  borderRadius: '20px',
  overflow: 'hidden',
  border: '1px solid #1e293b',
};

const floatingThemeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '20px',
  left: '20px',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  backgroundColor: '#111c2e',
  border: '1.5px solid #1e293b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '20px',
  cursor: 'pointer',
  zIndex: 999,
  boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
};

const floatingWazeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '80px',
  right: '20px',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  backgroundColor: '#33ccff',
  border: '2px solid #ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  zIndex: 999,
  boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
};

const floatingCenterBtnStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '20px',
  right: '20px',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  backgroundColor: '#111c2e',
  border: '1.5px solid #1e293b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '18px',
  cursor: 'pointer',
  zIndex: 999,
  boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
};

const centerPinOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -100%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  pointerEvents: 'none',
  zIndex: 1000,
};

const targetPinHeadStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  backgroundColor: '#ffffff',
  border: '3px solid #0f172a',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 8px rgba(0,0,0,0.5)',
};

const targetPinInnerBlackStyle: React.CSSProperties = {
  width: '10px',
  height: '10px',
  backgroundColor: '#000000',
  borderRadius: '2px',
};

const pinStickStyle: React.CSSProperties = {
  width: '3px',
  height: '12px',
  backgroundColor: '#ffffff',
};

const pinBlueBaseStyle: React.CSSProperties = {
  width: '12px',
  height: '12px',
  borderRadius: '50%',
  backgroundColor: '#38bdf8',
  border: '2px solid #ffffff',
};

const pinBottomBarStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '16px',
  left: '16px',
  right: '16px',
  backgroundColor: '#18181b',
  borderRadius: '18px',
  padding: '12px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  zIndex: 1000,
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  border: '1px solid #27272a',
};

const pinBackBtnStyle: React.CSSProperties = {
  background: '#27272a',
  border: 'none',
  borderRadius: '50%',
  width: '36px',
  height: '36px',
  color: '#ffffff',
  fontSize: '1.1rem',
  fontWeight: 900,
  cursor: 'pointer',
};

const pinInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '12px',
  border: '1px solid #3f3f46',
  backgroundColor: '#27272a',
  color: '#ffffff',
  fontSize: '0.9rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const pinConfirmBtnStyle: React.CSSProperties = {
  background: '#ffffff',
  color: '#000000',
  border: 'none',
  borderRadius: '14px',
  padding: '10px 18px',
  fontWeight: 900,
  fontSize: '0.9rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  padding: '20px',
  boxSizing: 'border-box',
};

const modalPlanCardStyle: React.CSSProperties = {
  backgroundColor: '#18181b',
  borderRadius: '24px',
  padding: '28px',
  width: '100%',
  maxWidth: '520px',
  border: '1px solid #27272a',
  boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
  color: '#ffffff',
};

const modalCloseBtnStyle: React.CSSProperties = {
  background: '#27272a',
  border: 'none',
  borderRadius: '50%',
  width: '32px',
  height: '32px',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 900,
};

const inputsContainerCardStyle: React.CSSProperties = {
  backgroundColor: '#27272a',
  borderRadius: '16px',
  padding: '12px 16px',
  border: '1px solid #3f3f46',
  marginBottom: '14px',
};

const disabledInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: '#a1a1aa',
  fontSize: '0.85rem',
  fontWeight: 700,
  outline: 'none',
};

const activeSearchInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: '#ffffff',
  fontSize: '0.95rem',
  fontWeight: 800,
  outline: 'none',
};

const pinModeTriggerBtnStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#ffffff',
  color: '#000000',
  border: 'none',
  borderRadius: '14px',
  padding: '12px',
  fontWeight: 900,
  fontSize: '0.9rem',
  cursor: 'pointer',
  marginBottom: '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
};

const suggestionItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '10px 14px',
  backgroundColor: '#18181b',
  borderRadius: '14px',
  border: '1px solid #27272a',
  cursor: 'pointer',
};

/* ESTILOS PARA EL MODAL DE CONFIRMACIÓN DE CANCELAR VIAJE (WEB) */
const confirmModalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  padding: '20px',
  boxSizing: 'border-box',
};

const confirmModalCardStyle: React.CSSProperties = {
  backgroundColor: '#18181b',
  borderRadius: '24px',
  padding: '28px',
  width: '100%',
  maxWidth: '380px',
  border: '1px solid #27272a',
  boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  color: '#ffffff',
};

const warningIconCircleStyle: React.CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '32px',
  backgroundColor: 'rgba(239, 68, 68, 0.15)',
  border: '1.5px solid rgba(239, 68, 68, 0.3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '16px',
};

const confirmModalTitleStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '1.2rem',
  fontWeight: 900,
  color: '#ffffff',
};

const confirmModalSubStyle: React.CSSProperties = {
  margin: '0 0 24px 0',
  fontSize: '0.85rem',
  color: '#a1a1aa',
  lineHeight: 1.4,
};

const confirmButtonsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  width: '100%',
};

const keepTripBtnStyle: React.CSSProperties = {
  flex: 1,
  backgroundColor: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: '14px',
  padding: '12px',
  color: '#ffffff',
  fontWeight: 800,
  fontSize: '0.9rem',
  cursor: 'pointer',
};

const confirmCancelBtnStyle: React.CSSProperties = {
  flex: 1,
  backgroundColor: '#ef4444',
  border: 'none',
  borderRadius: '14px',
  padding: '12px',
  color: '#ffffff',
  fontWeight: 900,
  fontSize: '0.9rem',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)',
};

// --- Generador de Estilos CSS SaaS Dinámicos (Mapa de Monitoreo) ---
