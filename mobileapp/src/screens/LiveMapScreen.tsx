import React, { useEffect, useRef, useState, useMemo } from 'react';
import { isAxiosError } from 'axios';
import { arrivalEligible } from '../utils/arrivalEligibility';
import {
  StyleSheet,
  Alert,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  ScrollView,
  Modal,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { placeStorageKey } from '../services/userPlaces';
import { useToast } from '../context/ToastContext';
import { useAppTheme } from '../theme/AppTheme';
import { DialogViewport } from '../components/MobileUI';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { LeafletNativeMap, type LeafletMapHandle } from '../components/LeafletNativeMap';
import { TrackingVehiclesFeed } from './TrackingVehiclesFeed';
import type { MobileTrackingSnapshot } from '../types/telemetry';
import { useFleetTelemetry } from '../hooks/useFleetTelemetry';
import { validHeading } from '../utils/navigationTelemetry';
import type { NavigationSessionHandle } from '../hooks/useNavigationSession';
import type { NavigationPlace, NavigationRoute, NavigationStep as RouteStep } from '../types/navigation';
import { remainingRouteInfo, nextRouteStep } from '../utils/routeProgress';
import type { FleetBus } from '../utils/fleetTelemetry';

export interface LiveMapScreenProps {
  navigation: NavigationSessionHandle;
  active?: boolean;
  user?: any;
  onNavigateTab?: (tab: string) => void;
  isPrivacyMode?: boolean;
  onTogglePrivacyMode?: () => void;
  mapTheme?: 'dark' | 'light';
  tracking?: MobileTrackingSnapshot;
  onFinishAssignedTrip?: () => Promise<boolean>;
  finishingTrip?: boolean;
}

export type BusData = FleetBus;

export type SavedLocation = NavigationPlace;

// 🏬 Puntos de Interés Populares y Lugares Conocidos (Autocompletado Rápido Estilo Google Maps)
export const POPULAR_LOCAL_PLACES: SavedLocation[] = [
  {
    id: 'poi-pradera-xela',
    name: 'Centro Comercial Pradera Xela',
    address: 'Avenida Las Américas 7-04, Zona 3, Quetzaltenango',
    lat: 14.8512,
    lng: -91.5280,
    icon: '',
    placeType: 'Centro Comercial',
    timestamp: Date.now(),
  },
  {
    id: 'poi-utz-ulew',
    name: 'Utz Ulew Mall & Hotel',
    address: '19 Avenida 2-40, Zona 3, Quetzaltenango',
    lat: 14.8465,
    lng: -91.5250,
    icon: '',
    placeType: 'Centro Comercial',
    timestamp: Date.now(),
  },
  {
    id: 'poi-parque-centroamerica',
    name: 'Parque Centroamérica (Parque Central)',
    address: 'Zona 1, Centro Histórico, Quetzaltenango',
    lat: 14.8347,
    lng: -91.5181,
    icon: '',
    placeType: 'Parque / Plaza Central',
    timestamp: Date.now(),
  },
  {
    id: 'poi-terminal-minerva',
    name: 'Terminal de Buses Minerva',
    address: '4a Calle y 24 Avenida, Zona 3, Quetzaltenango',
    lat: 14.8430,
    lng: -91.5350,
    icon: '',
    placeType: 'Estación de Buses',
    timestamp: Date.now(),
  },
  {
    id: 'poi-hospital-regional',
    name: 'Hospital Regional de Occidente',
    address: 'San Mateo / Zona 8, Quetzaltenango',
    lat: 14.8490,
    lng: -91.5510,
    icon: '',
    placeType: 'Hospital',
    timestamp: Date.now(),
  },
  {
    id: 'poi-cunoc-usac',
    name: 'CUNOC - Universidad de San Carlos',
    address: 'Calle Rodolfo Robles 39-61, Zona 1, Quetzaltenango',
    lat: 14.8380,
    lng: -91.5270,
    icon: '',
    placeType: 'Universidad',
    timestamp: Date.now(),
  },
  {
    id: 'poi-url-landivar',
    name: 'Universidad Rafael Landívar (Campus Xela)',
    address: '14 Avenida 0-43, Zona 3, Quetzaltenango',
    lat: 14.8410,
    lng: -91.5230,
    icon: '',
    placeType: 'Universidad',
    timestamp: Date.now(),
  },
  {
    id: 'poi-teatro-municipal',
    name: 'Teatro Municipal de Quetzaltenango',
    address: '1a Calle y 14 Avenida, Zona 1, Quetzaltenango',
    lat: 14.8375,
    lng: -91.5195,
    icon: '',
    placeType: 'Monumento Histórico',
    timestamp: Date.now(),
  },
  {
    id: 'poi-interplaza-xela',
    name: 'Centro Comercial Interplaza Xela',
    address: 'Km 205 Carretera Interamericana, La Esperanza',
    lat: 14.8720,
    lng: -91.5620,
    icon: '',
    placeType: 'Centro Comercial',
    timestamp: Date.now(),
  },
  {
    id: 'poi-mercado-democracia',
    name: 'Mercado La Democracia',
    address: '15 Avenida y 1a Calle, Zona 3, Quetzaltenango',
    lat: 14.8420,
    lng: -91.5210,
    icon: '',
    placeType: 'Mercado Municipal',
    timestamp: Date.now(),
  },
  {
    id: 'poi-monumento-marimba',
    name: 'Monumento a la Marimba (Las Rosas)',
    address: 'Rotonda Las Rosas, Zona 5, Quetzaltenango',
    lat: 14.8480,
    lng: -91.5030,
    icon: '',
    placeType: 'Monumento / Rotonda',
    timestamp: Date.now(),
  },
  {
    id: 'poi-monumento-tecun',
    name: 'Monumento a Tecún Umán',
    address: 'Rotonda Tecún Umán, Zona 7, Quetzaltenango',
    lat: 14.8520,
    lng: -91.4920,
    icon: '',
    placeType: 'Monumento / Entrada a Xela',
    timestamp: Date.now(),
  },
];

export type NavigationStep = RouteStep;
export type RouteOption = NavigationRoute;

export const DEFAULT_INITIAL_SAVED_FAVORITES: SavedLocation[] = [
  {
    id: 'fav-terminal-minerva',
    name: 'Terminal Minerva (Zona 3)',
    address: '4a Calle y 24 Avenida, Zona 3, Quetzaltenango',
    lat: 14.8430,
    lng: -91.5350,
    icon: '',
    placeType: 'Terminal de Buses',
    isFavorite: true,
    timestamp: Date.now(),
  },
  {
    id: 'fav-parque-central',
    name: 'Parque Centroamérica (Parque Central)',
    address: 'Zona 1, Centro Histórico, Quetzaltenango',
    lat: 14.8347,
    lng: -91.5181,
    icon: '',
    placeType: 'Parque / Plaza Central',
    isFavorite: true,
    timestamp: Date.now(),
  },
  {
    id: 'fav-monumento-marimba',
    name: 'Monumento a la Marimba / Las Rosas',
    address: 'Zona 5, Quetzaltenango',
    lat: 14.8480,
    lng: -91.5030,
    icon: '',
    placeType: 'Punto de Interés',
    isFavorite: true,
    timestamp: Date.now(),
  },
  {
    id: 'fav-pradera-xela',
    name: 'Centro Comercial Pradera Xela',
    address: 'Avenida Las Américas 7-04, Zona 3',
    lat: 14.8512,
    lng: -91.5280,
    icon: '',
    placeType: 'Centro Comercial',
    isFavorite: true,
    timestamp: Date.now(),
  },
  {
    id: 'fav-taller-base',
    name: 'Base de Operaciones y Taller',
    address: 'Periférico Norte, Quetzaltenango',
    lat: 14.8560,
    lng: -91.5150,
    icon: '',
    placeType: 'Base de Transporte',
    isFavorite: true,
    timestamp: Date.now(),
  },
];

export interface PredefinedRoute {
  id: string;
  name: string;
  originName: string;
  destName: string;
  destLat: number;
  destLng: number;
  usageCount: number;
  avgDurationMin: number;
  distKm: number;
}

// 🚌 Catálogo de Rutas Oficiales (Solo nombres limpios, sin prefijos "Ruta 1:", etc.)
export const REGISTERED_BUS_ROUTES: PredefinedRoute[] = [
  {
    id: 'route-terminal-parque',
    name: 'Terminal Minerva ➔ Parque Centroamérica',
    originName: 'Terminal Minerva, Zona 3',
    destName: 'Parque Centroamérica, Zona 1',
    destLat: 14.8347,
    destLng: -91.5181,
    usageCount: 142,
    avgDurationMin: 18,
    distKm: 4.8,
  },
  {
    id: 'route-periferico-rosas',
    name: 'Periférico Sur ➔ Las Rosas',
    originName: 'Periférico Sur',
    destName: 'Monumento a la Marimba / Las Rosas, Zona 5',
    destLat: 14.8480,
    destLng: -91.5030,
    usageCount: 118,
    avgDurationMin: 24,
    distKm: 7.2,
  },
  {
    id: 'route-ostuncalco-esperanza',
    name: 'San Juan Ostuncalco ➔ La Esperanza',
    originName: 'La Esperanza',
    destName: 'Parque Central San Juan Ostuncalco',
    destLat: 14.8690,
    destLng: -91.6210,
    usageCount: 95,
    avgDurationMin: 32,
    distKm: 12.5,
  },
  {
    id: 'route-salcaja-monumento',
    name: 'Salcajá ➔ Monumento a Tecún Umán',
    originName: 'Centro de Salcajá',
    destName: 'Monumento a Tecún Umán, Zona 7',
    destLat: 14.8520,
    destLng: -91.4920,
    usageCount: 88,
    avgDurationMin: 22,
    distKm: 8.4,
  },
  {
    id: 'route-almolonga-centro',
    name: 'Almolonga ➔ Parque Centroamérica',
    originName: 'Mercado de Almolonga',
    destName: 'Parque Centroamérica, Zona 1',
    destLat: 14.8150,
    destLng: -91.5050,
    usageCount: 76,
    avgDurationMin: 15,
    distKm: 5.1,
  },
  {
    id: 'route-totonicapan-xela',
    name: 'Totonicapán ➔ Terminal Minerva',
    originName: 'Terminal de Totonicapán',
    destName: 'Terminal Minerva, Zona 3',
    destLat: 14.9110,
    destLng: -91.3610,
    usageCount: 64,
    avgDurationMin: 45,
    distKm: 28.0,
  },
  {
    id: 'route-cantel-llanodelpinal',
    name: 'Cantel ➔ Llano del Pinal',
    originName: 'Cantel Centro',
    destName: 'Llano del Pinal / Volcán Santa María',
    destLat: 14.8090,
    destLng: -91.5540,
    usageCount: 52,
    avgDurationMin: 28,
    distKm: 11.2,
  },
];

// 🏆 3 Rutas más usadas de la última semana
export const TOP_WEEKLY_ROUTES: PredefinedRoute[] = REGISTERED_BUS_ROUTES.slice(0, 3);

// Coordenadas por defecto (Quetzaltenango, Guatemala)
const DEFAULT_CENTER = { lat: 14.8347, lng: -91.5181 };

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#102229' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9fb0b4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#102229' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#355159' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#102229' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#183038' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#173a32' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#29434a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#172b31' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4c4b3f' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#6e5b42' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#183038' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a303d' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#71a8b5' }] },
];


// Función para calcular distancia en KM (Fórmula Haversine)
const getDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
};

// Formato de duración en Horas y Minutos estilo Google Maps
const formatDuration = (totalMinutes: number): string => {
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
};

// Formato de tiempo relativo para los viajes de los últimos 7 días
const formatRelativeTime = (timestamp: number): string => {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 1) return 'Hace un momento';
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ayer';
  return `Hace ${diffDays} días`;
};

export const LiveMapScreen: React.FC<LiveMapScreenProps> = ({
  navigation,
  active = true,
  user,
  isPrivacyMode: propsPrivacyMode,
  onTogglePrivacyMode,
  mapTheme: propsMapTheme,
  tracking,
  onFinishAssignedTrip,
  finishingTrip = false,
}) => {
  const { showToast } = useToast();
  const { colors } = useAppTheme();
  const mapRef = useRef<LeafletMapHandle | null>(null);
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const [mapPanelHeight, setMapPanelHeight] = useState(viewportHeight);

  // Rol del usuario: Piloto vs Administrador / SuperAdministrador
  const isPilot = user?.tipoRol === 'Piloto';

  // 🛡️ Modo Privacidad del Piloto
  const [isPrivacyModeState, setIsPrivacyModeState] = useState<boolean>(propsPrivacyMode ?? false);
  const isPrivacyMode = propsPrivacyMode !== undefined ? propsPrivacyMode : isPrivacyModeState;
  const [showPrivacyReminderModal, setShowPrivacyReminderModal] = useState<boolean>(false);

  useEffect(() => {
    if (propsPrivacyMode === undefined) {
      AsyncStorage.getItem(`@pilot_privacy_mode_${user?.idUsuario}`).then((val) => {
        if (val !== null) {
          setIsPrivacyModeState(val === 'true');
        }
      });
    }
  }, [propsPrivacyMode]);

  const handleActivateGpsAndWork = async () => {
    if (onTogglePrivacyMode && isPrivacyMode) {
      onTogglePrivacyMode();
    } else {
      setIsPrivacyModeState(false);
      await AsyncStorage.setItem(`@pilot_privacy_mode_${user?.idUsuario}`, 'false').catch(() => {});
    }
  };

  // Tema del mapa (Modo Noche / Modo Normal Brillante)
  const [mapThemeState, setMapThemeState] = useState<'dark' | 'light'>('dark');
  const mapTheme = propsMapTheme || mapThemeState;

  // Estados del mapa y GPS en Tiempo Real
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [userAddress, setUserAddress] = useState<string>('Tu ubicación actual');
  const [originInputText, setOriginInputText] = useState<string>('Salida: Tu ubicación actual');
  const [gpsStatus, setGpsStatus] = useState<string>('Conectando satélites...');
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const buses = useFleetTelemetry(!isPilot && Boolean(user), user?.idUsuario);
  const { destination: selectedDestination, routes: activeRoutesList, selectedRouteIndex: selectedRouteIdx,
    tripActive: isTripActive, followUser, calculating: isCalculatingRoute } = navigation.state;
  const { setDestination: setSelectedDestination, setSelectedRouteIdx, setIsTripActive, setFollowUser } = navigation;
  const [viewMode, setViewMode] = useState<'map' | 'feed'>('map');
  const [selectedFloatingBus, setSelectedFloatingBus] = useState<BusData | null>(null);

  // Estados para Administrador y SuperAdministrador
  const [showFleetModal, setShowFleetModal] = useState<boolean>(false);
  const [fleetSearchFilter, setFleetSearchFilter] = useState<string>('');
  const [isAdminHeaderCollapsed, setIsAdminHeaderCollapsed] = useState<boolean>(false);

  // Referencias de control de navegación y cálculo dinámico de salida
  const mapCenterCoordsRef = useRef<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const lastGeocodedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRouteCalculationOriginRef = useRef<{ lat: number; lng: number } | null>(null);

  // Estados de Modos de Pantalla
  const [showPlanModal, setShowPlanModal] = useState<boolean>(false);
  const [showMapOptions, setShowMapOptions] = useState(false);
  const [showSavedPlacesModal, setShowSavedPlacesModal] = useState<boolean>(false);
  const [isPinSelectMode, setIsPinSelectMode] = useState<boolean>(false);
  const [isAddingLocationToSaved, setIsAddingLocationToSaved] = useState<boolean>(false);
  const [customPinName, setCustomPinName] = useState<string>('');
  
  // Búsqueda de Destinos y Autocompletado en Vivo
  const [destinationSearch, setDestinationSearch] = useState<string>('');
  const [searchSuggestions, setSearchSuggestions] = useState<SavedLocation[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState<boolean>(false);
  const searchDebounceRef = useRef<any>(null);

  // Rutas y Rutas Alternas Activas
  const [showServerRouteModal, setShowServerRouteModal] = useState(false);
  const [serverRouteName, setServerRouteName] = useState('');
  const [savingServerRoute, setSavingServerRoute] = useState(false);
  const [serverRouteError, setServerRouteError] = useState<string | null>(null);
  const selectedDestinationRef = useRef<SavedLocation | null>(null);
  const guideStartEpoch = useRef(0);
  useEffect(() => { guideStartEpoch.current++; return () => { guideStartEpoch.current++; }; }, [selectedDestination?.id, user?.idUsuario]);
  useEffect(() => {
    selectedDestinationRef.current = selectedDestination;
  }, [selectedDestination]);

  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  const selectedRoute = activeRoutesList[selectedRouteIdx];
  const routeInfo = selectedRoute ? remainingRouteInfo(selectedRoute, navigation.geometry,
    isTripActive ? navigation.state.progress.distanceMeters : 0) : null;

  // 🚀 ESTADOS DE CICLO DE VIAJE: INICIAR VIAJE / CANCELAR VIAJE
  const isTripActiveRef = useRef<boolean>(false);
  useEffect(() => {
    isTripActiveRef.current = isTripActive;
  }, [isTripActive]);

  const [showCancelTripModal, setShowCancelTripModal] = useState<boolean>(false);

  // One arrival prompt per approach; dismissal cannot be undone by a timer.
  const [showArrivalModal, setShowArrivalModal] = useState<boolean>(false);
  const arrivalCooldownRef = useRef<boolean>(false);
  const arrivalSnoozeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El rastreo vive en el nivel de sesión para continuar aunque el piloto cambie de pantalla.
  const streamTelemetryNow = tracking?.streamTelemetryNow ?? (() => {});

  const openServerRouteModal = () => {
    if (!selectedDestination) return;
    setServerRouteError(null);
    setServerRouteName(
      tracking?.assignedTrip?.nombreRuta && tracking.assignedTrip.nombreRuta !== 'N/D'
        ? tracking.assignedTrip.nombreRuta
        : `Ruta a ${selectedDestination.name}`
    );
    setShowServerRouteModal(true);
  };

  const saveServerRoute = async () => {
    const tripId = tracking?.assignedTrip?.idViaje;
    if (!tripId || !selectedDestination || serverRouteName.trim().length < 2 || savingServerRoute) return;

    try {
      setSavingServerRoute(true);
      setServerRouteError(null);
      await api.post(`/viajes/${tripId}/guardar-ruta`, {
        nombreRuta: serverRouteName.trim(),
        origen: (userAddress || 'Ubicación actual').slice(0, 100),
        destino: selectedDestination.name.slice(0, 100),
        origenLatitud: userLocation?.lat,
        origenLongitud: userLocation?.lng,
        destinoLatitud: selectedDestination.lat,
        destinoLongitud: selectedDestination.lng,
      });
      setShowServerRouteModal(false);
      tracking?.retry();
    } catch (error) {
      const payload = isAxiosError(error) ? error.response?.data as { mensaje?: string; title?: string } | undefined : undefined;
      setServerRouteError(payload?.mensaje || payload?.title || 'No se pudo guardar la ruta. Intenta de nuevo.');
    } finally {
      setSavingServerRoute(false);
    }
  };

  useEffect(() => {
    if (!isPilot || !tracking?.location) return;
    setUserLocation(tracking.displayLocation ?? tracking.location);
    userLocationRef.current = tracking.displayLocation ?? tracking.location;
    setCurrentSpeed(tracking.speedKmh);
    setUserHeading(tracking.heading);
    setGpsStatus(tracking.statusText);

    const { lat, lng } = tracking.location;
    if (
      !lastGeocodedCoordsRef.current
      || getDistanceKm(lastGeocodedCoordsRef.current.lat, lastGeocodedCoordsRef.current.lng, lat, lng) > 0.08
    ) {
      void reverseGeocodeUserLocation(lat, lng);
    }

    if (selectedDestinationRef.current && !isTripActiveRef.current) {
      const lastOrigin = lastRouteCalculationOriginRef.current;
      if (!lastOrigin || getDistanceKm(lastOrigin.lat, lastOrigin.lng, lat, lng) >= 0.03) {
        void drawRouteOnMap(
          selectedDestinationRef.current.lat,
          selectedDestinationRef.current.lng,
          selectedDestinationRef.current.name,
          { lat, lng },
          false,
        );
      }
    }

    if (selectedDestinationRef.current && isTripActiveRef.current) {
      const remainingKm = getDistanceKm(
        lat,
        lng,
        selectedDestinationRef.current.lat,
        selectedDestinationRef.current.lng,
      );
      if (remainingKm > 0.15 && tracking.locationFresh) arrivalCooldownRef.current = false;
      if (!arrivalCooldownRef.current && arrivalEligible({ distanceMeters: remainingKm * 1000,
        accuracy: tracking.accuracy, timestamp: tracking.locationTimestamp,
        matched: navigation.state.progress.matched, routeRemainingMeters: navigation.geometry.total - navigation.state.progress.distanceMeters })) setShowArrivalModal(true);
    }
  }, [isPilot, tracking?.heading, tracking?.location, tracking?.displayLocation, tracking?.speedKmh, tracking?.statusText]);

  // Historial de Ubicaciones y Lugares Guardados
  const [locationHistory, setLocationHistory] = useState<SavedLocation[]>([]);
  const [savedFavorites, setSavedFavorites] = useState<SavedLocation[]>([]);
  const [recentStartedTrips, setRecentStartedTrips] = useState<SavedLocation[]>([]);

  // Flota real de autobuses activos
  const realFleetBuses = buses.filter(b => Boolean(b && b.placaAutobus));

  // Filtrado de autobuses en el modal de Administrador
  const filteredBuses = realFleetBuses.filter(b => 
    b.placaAutobus.toLowerCase().includes(fleetSearchFilter.toLowerCase()) ||
    (b.nombrePiloto && b.nombrePiloto.toLowerCase().includes(fleetSearchFilter.toLowerCase())) ||
    (b.nombreRuta && b.nombreRuta.toLowerCase().includes(fleetSearchFilter.toLowerCase()))
  );

  // Cargar historial de ubicaciones semanales, favoritos y tema guardado
  useEffect(() => {
    loadStoredLocations();
    loadMapThemePreference();
  }, []);

  const loadMapThemePreference = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem('@map_theme_preference');
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setMapThemeState(savedTheme);
      }
    } catch (e) {
      console.warn('Error cargando tema del mapa:', e);
    }
  };

  // Alternar entre Modo Noche y Modo Normal Brillante
  const toggleMapTheme = async () => {
    const nextTheme = mapTheme === 'dark' ? 'light' : 'dark';
    setMapThemeState(nextTheme);
    try {
      await AsyncStorage.setItem('@map_theme_preference', nextTheme);
    } catch (e) {
      console.warn('Error guardando preferencia de tema:', e);
    }
  };

  const loadStoredLocations = async () => {
    try {
      const readPlaces = async (name: string): Promise<SavedLocation[]> => {
        const raw = await AsyncStorage.getItem(placeStorageKey(user?.idUsuario, name));
        const data: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data.filter(item => item && typeof item.name === 'string'
          && typeof item.address === 'string' && Number.isFinite(item.lat) && Number.isFinite(item.lng)) : [];
      };
      const [history, favorites, recent] = await Promise.all([
        readPlaces('history'), readPlaces('favorites'), readPlaces('trip-starts'),
      ]);
      setLocationHistory(history);
      setSavedFavorites(favorites);
      setRecentStartedTrips(recent.filter(item => item.timestamp >= Date.now() - 7 * 24 * 60 * 60 * 1000)
        .sort((left, right) => right.timestamp - left.timestamp).slice(0, 3));
    } catch {
      showToast('No se pudieron cargar tus lugares guardados. Intenta abrirlos de nuevo.', 'error', 'Lugares guardados');
    }
  };

  // Registrar inicio de viaje para mantener las 3 últimas ubicaciones de los últimos 7 días
  const recordTripStart = async (place: SavedLocation) => {
    try {
      const now = Date.now();
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
      const newEntry: SavedLocation = {
        ...place,
        timestamp: now,
      };
      const filtered = recentStartedTrips.filter(
        t => t.name.toLowerCase() !== place.name.toLowerCase() && (t.timestamp || 0) >= sevenDaysAgo
      );
      const updated = [newEntry, ...filtered];
      setRecentStartedTrips(updated.slice(0, 3));
      await AsyncStorage.setItem(placeStorageKey(user?.idUsuario, 'trip-starts'), JSON.stringify(updated)).catch(() => {});
    } catch (e) {
      console.warn('Error guardando inicio de viaje:', e);
    }
  };

  const handleSaveCurrentPinLocation = async () => {
    Keyboard.dismiss();
    const lat = mapCenterCoordsRef.current.lat;
    const lng = mapCenterCoordsRef.current.lng;
    const name = customPinName.trim() || `Ubicación Guardada (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    const newPlace: SavedLocation = {
      id: `fav-${Date.now()}`,
      name,
      address: `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)} • Quetzaltenango`,
      lat,
      lng,
      icon: '',
      placeType: 'Punto Favorito',
      isFavorite: true,
      timestamp: Date.now()
    };

    const updated = [newPlace, ...savedFavorites];
    setSavedFavorites(updated);
    await AsyncStorage.setItem(placeStorageKey(user?.idUsuario, 'favorites'), JSON.stringify(updated)).catch(() => {});
    setIsPinSelectMode(false);
    setIsAddingLocationToSaved(false);
    setCustomPinName('');
    setShowSavedPlacesModal(true);
  };

  const handleDeleteSavedLocation = async (id: string) => {
    const updated = savedFavorites.filter(item => item.id !== id);
    setSavedFavorites(updated);
    await AsyncStorage.setItem(placeStorageKey(user?.idUsuario, 'favorites'), JSON.stringify(updated)).catch(() => {});
  };

  // Guardar un destino en el historial reciente
  const recordDestinationHistory = async (place: SavedLocation) => {
    try {
      const updated = [
        place,
        ...locationHistory.filter(item => item.name.toLowerCase() !== place.name.toLowerCase())
      ].slice(0, 15);
      setLocationHistory(updated);
      await AsyncStorage.setItem(placeStorageKey(user?.idUsuario, 'history'), JSON.stringify(updated));
    } catch (e) {
      console.warn('Error guardando destino en historial:', e);
    }
  };

  useEffect(() => { if (isPilot) setViewMode('map'); }, [isPilot]);

  // 🛰️ SEGUIMIENTO GPS CONTINUO EN TIEMPO REAL: ACTUALIZA LA SALIDA AL MOVERSE (CONTROLADO POR PRIVACIDAD)
  useEffect(() => {
    if (isPrivacyMode) {
      setUserLocation(null);
      setGpsStatus('Modo Privacidad: GPS Desconectado');
      setOriginInputText('Modo Privacidad (GPS Apagado)');
      setCurrentSpeed(0);
      return;
    }

    // El piloto ya comparte el único lector GPS de sesión; el mapa reutiliza esa señal
    // para evitar duplicar consumo de batería y suscripciones nativas.
    if (isPilot && tracking) return;

    let locationSub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;
    let isCancelled = false;

    const startLocationService = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || isCancelled) {
          setGpsStatus('Permiso de GPS denegado');
          return;
        }

        setGpsStatus('Satélites GPS conectados');

        const initialPos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (initialPos && initialPos.coords && !isCancelled) {
          const lat = initialPos.coords.latitude;
          const lng = initialPos.coords.longitude;
          setUserLocation({ lat, lng });
          reverseGeocodeUserLocation(lat, lng);
          if (mapRef.current) {
            mapRef.current.animateToRegion({
              latitude: lat,
              longitude: lng,
              latitudeDelta: 0.015,
              longitudeDelta: 0.015,
            }, 500);
          }
        }

        try {
          headingSub = await Location.watchHeadingAsync((h) => {
            if (isCancelled) return;
            const headingVal = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
            if (headingVal >= 0) {
              setUserHeading(Math.round(headingVal));
            }
          });
        } catch (e) {}

        locationSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 250, // 4 veces por segundo para fluidez absoluta sin saltos
            distanceInterval: 0.1, // Respuesta inmediata ante cualquier desplazamiento
          },
          (loc) => {
            if (loc && loc.coords && !isCancelled) {
              const { latitude, longitude, speed, heading } = loc.coords;
              const currentSpeedKmh = Math.max(0, Math.round((speed || 0) * 3.6));
              setCurrentSpeed(currentSpeedKmh);
              const newPos = { lat: latitude, lng: longitude };
              userLocationRef.current = newPos;
              setUserLocation(newPos);
              if (currentSpeedKmh >= 4 && validHeading(heading) != null) {
                setUserHeading(validHeading(heading));
              }
              setGpsStatus(`GPS Activo • ${currentSpeedKmh} km/h`);

              // Actualizar dirección de salida en tiempo real (umbral eficiente para no bloquear)
              if (
                !lastGeocodedCoordsRef.current ||
                getDistanceKm(lastGeocodedCoordsRef.current.lat, lastGeocodedCoordsRef.current.lng, latitude, longitude) > 0.08
              ) {
                reverseGeocodeUserLocation(latitude, longitude);
              }

              // 🔄 AL MOVERSE: Si no ha iniciado el viaje y cambió de posición, recalcular ruta
              if (selectedDestinationRef.current && !isTripActiveRef.current) {
                const lastOrigin = lastRouteCalculationOriginRef.current;
                if (
                  !lastOrigin ||
                  getDistanceKm(lastOrigin.lat, lastOrigin.lng, latitude, longitude) >= 0.03
                ) {
                  drawRouteOnMap(
                    selectedDestinationRef.current.lat,
                    selectedDestinationRef.current.lng,
                    selectedDestinationRef.current.name,
                    { lat: latitude, lng: longitude },
                    false
                  );
                }
              }

              // 🏁 COMPROBACIÓN DE LLEGADA AL DESTINO (Radio de ~50 metros)
              if (selectedDestinationRef.current && isTripActiveRef.current) {
                const distToDest = getDistanceKm(
                  latitude,
                  longitude,
                  selectedDestinationRef.current.lat,
                  selectedDestinationRef.current.lng
                );
                if (distToDest > 0.15 && Date.now() - loc.timestamp <= 15_000) arrivalCooldownRef.current = false;
                if (!arrivalCooldownRef.current && arrivalEligible({ distanceMeters: distToDest * 1000, accuracy: loc.coords.accuracy, timestamp: loc.timestamp,
                    matched: navigation.state.progress.matched, routeRemainingMeters: navigation.geometry.total - navigation.state.progress.distanceMeters })) {
                  setShowArrivalModal(true);
                }
              }
            }
          }
        );
      } catch (e) {
        console.warn('Error inicializando GPS móvil:', e);
        setGpsStatus('GPS en espera');
      }
    };

    startLocationService();

    return () => {
      isCancelled = true;
      if (locationSub) locationSub.remove();
      if (headingSub) headingSub.remove();
      if (arrivalSnoozeTimerRef.current) clearTimeout(arrivalSnoozeTimerRef.current);
    };
  }, [isPilot, isPrivacyMode]);

  // Geolocalización Inversa Dinámica
  const reverseGeocodeUserLocation = async (lat: number, lng: number) => {
    try {
      lastGeocodedCoordsRef.current = { lat, lng };
      const res = await api.get('/mapas/reversa', { params: { lat, lng }, timeout: 4_500 });
      if (res.data && res.data.address) {
        const a = res.data.address;
        const street = a.road || a.pedestrian || a.footway || a.building || '';
        const zone = a.neighbourhood || a.suburb || a.quarter || '';
        const city = a.city || a.town || a.village || 'Guatemala';
        const parts = [street, zone, city].filter(Boolean);
        if (parts.length > 0) {
          const formatted = parts.join(', ');
          setUserAddress(formatted);
          setOriginInputText(`Salida en vivo: ${formatted}`);
          return;
        }
      }
    } catch (e) {
      // Ignorar fallback
    }
    const fallback = `Salida GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    setUserAddress(fallback);
    setOriginInputText(`Salida en vivo: ${fallback}`);
  };

// Función auxiliar para normalizar texto de búsqueda (ignorar tildes y mayúsculas)
const normalizeSearchText = (str: string): string => {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

  // 🔍 Búsqueda Inteligente Estilo Google Maps con Motor Dual (Nominatim GT + Photon)
  const handleDestinationSearchChange = (text: string) => {
    setDestinationSearch(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!text || text.trim().length === 0) {
      setSearchSuggestions([]);
      setIsSearchingPlaces(false);
      return;
    }

    const normQuery = normalizeSearchText(text);
    const userLat = userLocation?.lat || DEFAULT_CENTER.lat;
    const userLng = userLocation?.lng || DEFAULT_CENTER.lng;

    // 1. Filtrar puntos de interés populares locales instantáneamente (0ms)
    const localMatches: SavedLocation[] = POPULAR_LOCAL_PLACES
      .filter(p => normalizeSearchText(p.name).includes(normQuery) || normalizeSearchText(p.address).includes(normQuery))
      .map(p => ({
        ...p,
        distanceKm: getDistanceKm(userLat, userLng, p.lat, p.lng),
      }));

    // 2. Filtrar catálogo de rutas oficiales
    const routeMatches: SavedLocation[] = REGISTERED_BUS_ROUTES
      .filter(r => normalizeSearchText(r.name).includes(normQuery) || normalizeSearchText(r.destName).includes(normQuery))
      .map(r => ({
        id: r.id,
        name: r.name,
        address: `${r.distKm} km • ~${r.avgDurationMin} min • Ruta Oficial`,
        lat: r.destLat,
        lng: r.destLng,
        distanceKm: getDistanceKm(userLat, userLng, r.destLat, r.destLng),
        isPredefinedRoute: true,
        icon: '',
        placeType: 'Ruta de Transporte',
        timestamp: Date.now(),
      }));

    const immediateResults = [...localMatches, ...routeMatches];
    setSearchSuggestions(immediateResults);

    if (normQuery.length < 2) {
      setIsSearchingPlaces(false);
      return;
    }

    setIsSearchingPlaces(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const seen = new Set<string>();
        const geoSuggestions: SavedLocation[] = [];

        immediateResults.forEach(r => {
          seen.add(`${r.name.toLowerCase()}_${r.lat.toFixed(3)}_${r.lng.toFixed(3)}`);
        });

        const searchResponse = await api.get('/mapas/buscar', {
          params: { consulta: text.trim() },
          timeout: 5_000,
        });

        if (Array.isArray(searchResponse.data)) {
          searchResponse.data.forEach((item: any, idx: number) => {
            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);
            if (isNaN(lat) || isNaN(lng)) return;

            const addr = item.address || {};
            const mainName = item.name || addr.road || addr.suburb || addr.neighbourhood || addr.city || addr.town || addr.village || text;
            const key = `${mainName.toLowerCase()}_${lat.toFixed(3)}_${lng.toFixed(3)}`;

            if (!seen.has(key)) {
              seen.add(key);
              const dist = getDistanceKm(userLat, userLng, lat, lng);
              const secondaryParts = [
                addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter,
                addr.city || addr.town || addr.village || addr.municipality,
                addr.state,
                'Guatemala'
              ].filter(Boolean);

              let placeType = 'Dirección';
              const type = (item.type || '').toLowerCase();
              const category = (item.category || '').toLowerCase();

              if (category === 'amenity' && (type.includes('restaurant') || type.includes('fast_food') || type.includes('cafe'))) {
                placeType = 'Restaurante';
              } else if (type.includes('hospital') || type.includes('clinic') || type.includes('pharmacy')) {
                placeType = 'Salud';
              } else if (type.includes('school') || type.includes('university') || type.includes('college')) {
                placeType = 'Educación';
              } else if (type.includes('mall') || type.includes('supermarket') || type.includes('shop')) {
                placeType = 'Comercio';
              } else if (type.includes('fuel')) {
                placeType = 'Gasolinera';
              } else if (type.includes('park') || type.includes('garden')) {
                placeType = 'Parque';
              } else if (type.includes('city') || type.includes('town') || type.includes('administrative')) {
                placeType = 'Municipio / Zona';
              } else if (type.includes('church') || type.includes('place_of_worship')) {
                placeType = 'Iglesia / Templo';
              }

              geoSuggestions.push({
                id: `nom-${item.place_id || idx}-${Date.now()}`,
                name: mainName,
                address: secondaryParts.slice(0, 3).join(', ') || item.display_name,
                lat,
                lng,
                distanceKm: dist,
                placeType,
                timestamp: Date.now(),
              });
            }
          });
        }


        const combined = [...immediateResults, ...geoSuggestions];
        combined.sort((a, b) => (a.distanceKm || 999) - (b.distanceKm || 999));
        setSearchSuggestions(combined);
      } catch (err) {
        console.warn('Error en búsqueda de lugares:', err);
      } finally {
        setIsSearchingPlaces(false);
      }
    }, 200);
  };

  // 🛣️ TRAZADO DINÁMICO DE RUTAS 100% REAL DESDE LA UBICACIÓN EXACTA DE SALIDA
  const drawRouteOnMap = async (
    destLat: number, destLng: number, destName: string,
    customOrigin?: { lat: number; lng: number }, autoFit = true,
  ) => {
    const destination = selectedDestinationRef.current;
    const origin = customOrigin ?? userLocation;
    if (!destination || !origin || destination.lat !== destLat || destination.lng !== destLng) return;
    lastRouteCalculationOriginRef.current = origin;
    const routes = await navigation.calculateRoutes({ ...destination, name: destName }, origin);
    if (routes && autoFit && !isTripActiveRef.current) {
      mapRef.current?.fitToCoordinates(routes[0].coords.map(p => ({ latitude: p[0], longitude: p[1] })),
        { edgePadding: { top: 30, right: 66, bottom: 80, left: 20 }, animated: true });
    }
  };

  // Limpiar Ruta
  const clearRouteOnMap = () => {
    selectedDestinationRef.current = null;
    navigation.clear();
    setShowArrivalModal(false);
    arrivalCooldownRef.current = false;
    if (arrivalSnoozeTimerRef.current) {
      clearTimeout(arrivalSnoozeTimerRef.current);
      arrivalSnoozeTimerRef.current = null;
    }
  };

  // 🏁 Manejo de Llegada a Destino
  const handleFinishTripFromArrivalModal = async () => {
    if (tracking?.assignedTrip && navigation.state.assignedTripId === tracking.assignedTrip.idViaje && onFinishAssignedTrip) {
      const finished = await onFinishAssignedTrip();
      if (!finished) return;
    }
    setShowArrivalModal(false);
    arrivalCooldownRef.current = false;
    if (arrivalSnoozeTimerRef.current) {
      clearTimeout(arrivalSnoozeTimerRef.current);
      arrivalSnoozeTimerRef.current = null;
    }
    clearRouteOnMap();
    setTimeout(() => {
      handleCenterOnUser();
    }, 150);
  };

  const handleCancelArrivalModal = () => {
    setShowArrivalModal(false);
    arrivalCooldownRef.current = true;

    // Suppress this approach until the driver leaves the arrival area.
    if (arrivalSnoozeTimerRef.current) {
      clearTimeout(arrivalSnoozeTimerRef.current);
    }
    arrivalSnoozeTimerRef.current = null;
  };

  // Manejo de inicio y cancelación de viaje
  const startGuide = async (tripId: number | null) => {
    const epoch = ++guideStartEpoch.current;
    let version = tracking?.assignedTrip?.version;
    let revision = navigation.state.assignedTripId === tripId ? navigation.state.assignedTripRevision : tracking?.assignedTrip?.revisionDestino;
    if (tripId && selectedDestination) {
      try {
        const response = await api.post<{ version: string; revisionDestino: number }>(`/viajes/${tripId}/destino`, {
          lat: selectedDestination.lat, lng: selectedDestination.lng, nombre: selectedDestination.name.slice(0, 150), revision: revision ?? 0,
        }, { headers: { 'X-Eunice-User': String(user?.idUsuario) } });
        if (epoch !== guideStartEpoch.current) return;
        version = response.data.version; revision = response.data.revisionDestino; tracking?.retry();
      } catch {
        tracking?.retry(); showToast('No se confirmó el destino del viaje. Actualiza la asignación y vuelve a iniciar la guía.', 'error', 'Destino pendiente'); return;
      }
    }
    if (epoch !== guideStartEpoch.current) return;
    navigation.bindTrip(tripId, version, revision);
    if (isPrivacyMode) {
      setShowPrivacyReminderModal(true);
      return;
    }
    setFollowUser(true);
    setIsTripActive(true);
    if (selectedDestination) {
      recordTripStart(selectedDestination);
      streamTelemetryNow(userLocation || undefined, tripId ? selectedDestination : null, Boolean(tripId));
    }
  };
  const handleStartTrip = () => {
    if (!selectedRoute || !userLocation || isCalculatingRoute) return;
    const assigned = tracking?.assignedTrip?.idViaje;
    if (assigned && navigation.state.assignedTripId !== assigned) {
      Alert.alert('¿Cómo usar esta guía?', 'La guía personal no cambia el destino ni finaliza el viaje asignado. El GPS del viaje conserva su configuración de privacidad.', [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Guía personal', onPress: () => startGuide(null) },
        { text: 'Usar para mi viaje', onPress: () => startGuide(assigned) },
      ]);
    } else startGuide(navigation.state.assignedTripId ?? null);
  };

  const handleConfirmActivateFromReminder = async () => {
    setShowPrivacyReminderModal(false);
    await handleActivateGpsAndWork();
    setIsTripActive(true);
    if (selectedDestination) {
      recordTripStart(selectedDestination);
      streamTelemetryNow(userLocation || undefined, navigation.state.assignedTripId ? selectedDestination : null, Boolean(navigation.state.assignedTripId));
    }
  };

  // Redirigir a Waze con o sin ruta establecida
  const handleOpenWazeNavigation = async () => {
    let wazeAppUrl = 'waze://';
    let wazeWebUrl = 'https://www.waze.com';

    if (selectedDestination) {
      const destLat = selectedDestination.lat;
      const destLng = selectedDestination.lng;
      wazeAppUrl = `waze://?ll=${destLat},${destLng}&navigate=yes`;
      wazeWebUrl = `https://www.waze.com/ul?ll=${destLat},${destLng}&navigate=yes`;
    }

    try {
      const canOpen = await Linking.canOpenURL(wazeAppUrl);
      if (canOpen) {
        await Linking.openURL(wazeAppUrl);
      } else {
        await Linking.openURL(wazeWebUrl);
      }
    } catch (err) {
      console.warn('Error abriendo Waze:', err);
      Linking.openURL(wazeWebUrl).catch(() => {});
    }
  };

  const handlePressCancelTrip = () => {
    setShowCancelTripModal(true);
  };

  const handleConfirmCancelTrip = () => {
    setShowCancelTripModal(false);
    clearRouteOnMap();
    streamTelemetryNow(userLocation || undefined, null, false);
    setTimeout(() => {
      handleCenterOnUser();
    }, 150);
  };

  const handleDismissCancelTrip = () => {
    setShowCancelTripModal(false);
  };

  // Centrar en el usuario
  const handleCenterOnUser = async () => {
    setFollowUser(true);
    if (isPilot && userLocation) {
      const position = navigation.state.progress.matched && navigation.state.progress.point
        ? navigation.state.progress.point : userLocation;
      mapRef.current?.followCoordinate({ latitude: position.lat, longitude: position.lng });
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (pos && pos.coords) {
          const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(newLoc);
          reverseGeocodeUserLocation(newLoc.lat, newLoc.lng);
          if (mapRef.current) {
            mapRef.current.animateToRegion({
              latitude: newLoc.lat,
              longitude: newLoc.lng,
              latitudeDelta: 0.012,
              longitudeDelta: 0.012,
            }, 800);
          }
          return;
        }
      }
      if (userLocation && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }, 800);
      }
    } catch (err) {
      if (userLocation && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }, 800);
      }
    }
  };

  // Centrar en autobús específico (Admin)
  const closeFleetModal = () => {
    Keyboard.dismiss();
    setFleetSearchFilter('');
    setShowFleetModal(false);
  };

  const handleFocusBus = (bus: BusData) => {
    closeFleetModal();
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: bus.latitud,
        longitude: bus.longitud,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      }, 800);
    }
  };

  // Centrar toda la flota (Admin)
  const handleRecenterFleet = () => {
    if (mapRef.current && buses.length > 0) {
      const coords = buses.map(b => ({ latitude: b.latitud, longitude: b.longitud }));
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    }
  };

  // Seleccionar destino y asignar ruta
  const handleSelectDestination = (place: SavedLocation) => {
    Keyboard.dismiss();
    setSelectedDestination(place);
    selectedDestinationRef.current = place;
    setShowPlanModal(false);
    setShowSavedPlacesModal(false);
    setIsPinSelectMode(false);
    setSearchSuggestions([]);
    recordDestinationHistory(place);
    recordTripStart(place);
    drawRouteOnMap(place.lat, place.lng, place.name, userLocation || undefined, true);
  };

  // Confirmar destino desde pin central
  const handleConfirmPinDestination = () => {
    Keyboard.dismiss();
    const lat = mapCenterCoordsRef.current.lat;
    const lng = mapCenterCoordsRef.current.lng;
    const placeName = destinationSearch.trim() || `Destino Seleccionado (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    const newDest: SavedLocation = {
      id: `custom-${Date.now()}`,
      name: placeName,
      address: `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`,
      lat,
      lng,
      timestamp: Date.now()
    };

    handleSelectDestination(newDest);
  };

  // Matching and progress live at session level, even while another tab is visible.
  const progress = navigation.state.progress;
  const currentNavProjection = isTripActive && progress.point ? {
    isSnappable: progress.matched, snappedCoord: progress.point, segmentBearing: progress.bearing ?? 0,
  } : null;
  const step = isTripActive && selectedRoute ? nextRouteStep(selectedRoute, progress.distanceMeters) : null;
  const currentLaneGuidance = step ? {
    instruction: step.instruction, distanceMeters: step.distanceMeters,
    maneuverIconName: step.type === 'arrive' ? 'flag-checkered'
      : step.type === 'roundabout' || step.type === 'rotary' ? 'rotate-right'
      : step.modifier?.includes('right') ? 'arrow-top-right'
      : step.modifier?.includes('left') ? 'arrow-top-left' : 'arrow-up',
  } : null;
  const effectiveHeading = (isTripActive && currentSpeed < 4 && progress.matched ? progress.bearing : null) ?? validHeading(userHeading)
    ?? (isTripActive && currentSpeed >= 4 && progress.matched ? progress.bearing : null);
  const mapRoutes = useMemo(() => activeRoutesList.map((route, idx) => ({
    id: String(route.id), selected: idx === selectedRouteIdx,
    coordinates: route.coords.map(p => ({ latitude: p[0], longitude: p[1] })),
  })), [activeRoutesList, selectedRouteIdx]);
  useEffect(() => {
    if (active) mapRef.current?.invalidateSize();
  }, [active]);

  return (
    <View style={[styles.container, mapTheme === 'light' && styles.containerLight]}
      onLayout={event => setMapPanelHeight(event.nativeEvent.layout.height)}>
        {/* 🧭 SEGMENTED TOGGLE SUPERIOR: EXCLUSIVO PARA ADMINISTRADOR / SUPERADMINISTRADOR */}
        {!isPilot && (
          <View style={styles.topSegmentedBarContainer}>
            <View style={[styles.topSegmentedBar, mapTheme === 'light' && styles.topSegmentedBarLight]}>
              <TouchableOpacity
                style={[styles.segmentBtn, viewMode === 'map' && styles.segmentBtnActive]}
                onPress={() => setViewMode('map')}
                activeOpacity={0.8}
              >
                <Feather name="navigation" size={13} color={viewMode === 'map' ? '#ffffff' : (mapTheme === 'light' ? '#64748b' : '#94a3b8')} />
                <Text style={[styles.segmentBtnText, mapTheme === 'light' && styles.segmentBtnTextLight, viewMode === 'map' && styles.segmentBtnTextActive]}>
                  Mapa GPS
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.segmentBtn, viewMode === 'feed' && styles.segmentBtnActive]}
                onPress={() => setViewMode('feed')}
                activeOpacity={0.8}
              >
                <Feather name="radio" size={13} color={viewMode === 'feed' ? '#ffffff' : (mapTheme === 'light' ? '#64748b' : '#94a3b8')} />
                <Text style={[styles.segmentBtnText, mapTheme === 'light' && styles.segmentBtnTextLight, viewMode === 'feed' && styles.segmentBtnTextActive]}>
                  Feed Unidades
                </Text>
              </TouchableOpacity>
            </View>

            {/* 🔽 Botón de Flechita para Ocultar / Mostrar el Panel del Mapa */}
            {viewMode === 'map' && (
              <TouchableOpacity
                style={[styles.collapseArrowBtn, mapTheme === 'light' && styles.collapseArrowBtnLight, isAdminHeaderCollapsed && styles.collapseArrowBtnCollapsed]}
                onPress={() => setIsAdminHeaderCollapsed(!isAdminHeaderCollapsed)}
                activeOpacity={0.7}
              >
                <Feather
                  name={isAdminHeaderCollapsed ? "chevron-down" : "chevron-up"}
                  size={18}
                  color={isAdminHeaderCollapsed ? "#ffffff" : "#ff9b6c"}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {!isPilot && viewMode === 'feed' ? (
          <TrackingVehiclesFeed
            selectedBusPlaca={selectedFloatingBus?.placaAutobus}
            onSelectBus={(bus) => {
              if (!Number.isFinite(bus.latitud) || !Number.isFinite(bus.longitud)) {
                setSelectedFloatingBus(null);
                setViewMode('map');
                return;
              }
              setSelectedFloatingBus({
                placaAutobus: bus.placaAutobus || bus.placa || 'Sin placa',
                nombrePiloto: bus.nombrePiloto || bus.conductor || 'Sin piloto en línea',
                nombreRuta: bus.nombreRuta || 'Sin ruta asignada',
                velocidadKmh: bus.velocidadKmh ?? 0,
                latitud: bus.latitud!,
                longitud: bus.longitud!,
                isTripActive: true,
              });
              setViewMode('map');
            }}
            onOpenMap={() => setViewMode('map')}
          />
        ) : (
          <>
            {/* 1. CABECERA SUPERIOR CONDICIONAL SEGÚN ROL */}
            {!isPilot ? (
              /* 👑 VISTA DE SUPERVISIÓN: ADMINISTRADOR / SUPERADMINISTRADOR */
              !isAdminHeaderCollapsed ? (
                <View style={[styles.adminHeaderBar, mapTheme === 'light' && styles.adminHeaderBarLight]}>
                  <View style={styles.adminHeaderTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.adminHeaderTitle, mapTheme === 'light' && styles.adminHeaderTitleLight]}>
                        Mapa de Monitoreo en Vivo
                      </Text>
                      <Text style={styles.adminHeaderCoordsText}>
                        GPS Activo: {userLocation ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : '14.8343, -90.5155'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.adminFleetBtn}
                      onPress={() => setShowFleetModal(true)}
                      activeOpacity={0.8}
                    >
                      <MaterialCommunityIcons name="bus" size={14} color="#ff9b6c" style={{ marginRight: 4 }} />
                      <Text style={styles.adminFleetBtnText} numberOfLines={2}>
                        {realFleetBuses.length === 0 ? 'Sin ubicación reciente' : `${realFleetBuses.length} ${realFleetBuses.length === 1 ? 'unidad con señal' : 'unidades con señal'}`}
                      </Text>
                      <Feather name="chevron-down" size={12} color="#94a3b8" style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.adminHeaderActionsRow}>
                    <TouchableOpacity
                      style={[styles.adminActionPillBtn, mapTheme === 'light' && styles.adminActionPillBtnLight]}
                      onPress={handleCenterOnUser}
                    >
                      <Feather name="crosshair" size={13} color="#d85f28" style={{ marginRight: 4 }} />
                      <Text style={[styles.adminActionPillBtnText, mapTheme === 'light' && styles.adminActionPillBtnTextLight]}>Mi Ubicación GPS</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adminActionPillBtn, mapTheme === 'light' && styles.adminActionPillBtnLight]}
                      onPress={handleRecenterFleet}
                    >
                      <Feather name="maximize-2" size={13} color="#d85f28" style={{ marginRight: 4 }} />
                      <Text style={[styles.adminActionPillBtnText, mapTheme === 'light' && styles.adminActionPillBtnTextLight]}>Centrar Flota</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adminCollapseMiniBtn, mapTheme === 'light' && styles.adminCollapseMiniBtnLight]}
                      onPress={() => setIsAdminHeaderCollapsed(true)}
                      activeOpacity={0.7}
                    >
                      <Feather name="chevron-up" size={16} color={mapTheme === 'light' ? '#64748b' : '#94a3b8'} />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null
            ) : (
              /* Pilot toolbar occupies real layout space; it never covers map controls. */
              !isPinSelectMode && (
                <ScrollView style={{ flexGrow: 0, maxHeight: Math.max(72, mapPanelHeight * .42) }} keyboardShouldPersistTaps="handled">
                <View style={[styles.pilotToolbar, mapTheme === 'light' && styles.pilotToolbarLight]}>
                  <View style={styles.pilotToolbarRow}>
                    {selectedDestination ? (
                      <View style={styles.pilotToolbarCopy}>
                        <Text style={[styles.pilotToolbarTitle, mapTheme === 'light' && styles.pilotToolbarTitleLight]}>
                          {isPrivacyMode ? 'GPS pausado · ruta conservada'
                            : isCalculatingRoute ? 'Calculando ruta…'
                            : currentLaneGuidance ? `En ${currentLaneGuidance.distanceMeters >= 1000
                              ? (currentLaneGuidance.distanceMeters / 1000).toFixed(1) + ' km'
                              : currentLaneGuidance.distanceMeters + ' m'}`
                            : selectedDestination.name}
                        </Text>
                        <Text style={[styles.pilotToolbarSubtitle, mapTheme === 'light' && styles.pilotToolbarSubtitleLight]}>
                          {isPrivacyMode ? 'Reanuda el GPS desde la barra superior.'
                            : currentLaneGuidance?.instruction ?? (routeInfo
                              ? `${routeInfo.distanceKm.toFixed(1)} km · ${formatDuration(routeInfo.durationMin)} estimados`
                              : 'Espera una posición GPS para calcular el recorrido.')}
                        </Text>
                      </View>
                    ) : (
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Buscar destino"
                        style={styles.pilotSearchButton} onPress={() => setShowPlanModal(true)}>
                        <Feather name="search" size={20} color="#d85f28" />
                        <View style={styles.pilotToolbarCopy}>
                          <Text style={[styles.pilotToolbarTitle, mapTheme === 'light' && styles.pilotToolbarTitleLight]}>Buscar destino</Text>
                          <Text style={[styles.pilotToolbarSubtitle, mapTheme === 'light' && styles.pilotToolbarSubtitleLight]} numberOfLines={2}>{isPrivacyMode ? 'GPS pausado por privacidad' : originInputText}</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Opciones del mapa"
                      accessibilityState={{ expanded: showMapOptions }} style={styles.pilotOptionsButton}
                      onPress={() => setShowMapOptions(value => !value)}>
                      <Feather name="more-horizontal" size={22} color={mapTheme === 'light' ? '#17343c' : '#ecf2f3'} />
                    </TouchableOpacity>
                  </View>
                  {!isTripActive && activeRoutesList.length > 1 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pilotRouteChoices}>
                      {activeRoutesList.map((route, index) => (
                        <TouchableOpacity key={route.id} accessibilityRole="button"
                          accessibilityState={{ selected: index === selectedRouteIdx }} style={styles.pilotTextButton}
                          onPress={() => setSelectedRouteIdx(index)}>
                          <Text style={[styles.pilotActionText, mapTheme === 'light' && styles.pilotActionTextLight, index === selectedRouteIdx && { textDecorationLine: 'underline' }]}>
                            Ruta {index + 1} · {route.distKm.toFixed(1)} km · {formatDuration(route.durationMin)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {selectedDestination && (
                    <View style={styles.pilotRouteActions}>
                      {isTripActive ? (
                        <>
                          <Text style={[styles.pilotRemaining, mapTheme === 'light' && styles.pilotToolbarSubtitleLight]}>
                            {routeInfo ? `${routeInfo.distanceKm.toFixed(1)} km · ${formatDuration(routeInfo.durationMin)} estimados` : selectedDestination.name}
                          </Text>
                          <TouchableOpacity accessibilityRole="button" style={styles.pilotTextButton} onPress={handlePressCancelTrip}>
                            <Text style={[styles.pilotStopText, mapTheme === 'light' && styles.pilotStopTextLight]}>Detener</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          {tracking?.assignedTrip && selectedRoute && <TouchableOpacity accessibilityRole="button"
                            style={styles.pilotTextButton} onPress={openServerRouteModal}><Text style={[styles.pilotActionText, mapTheme === 'light' && styles.pilotActionTextLight]}>Guardar</Text></TouchableOpacity>}
                          <TouchableOpacity accessibilityRole="button" style={styles.pilotTextButton} onPress={clearRouteOnMap}>
                            <Text style={[styles.pilotActionText, mapTheme === 'light' && styles.pilotActionTextLight]}>Cancelar</Text>
                          </TouchableOpacity>
                          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !selectedRoute || isCalculatingRoute }}
                            style={[styles.pilotStartButton, (!selectedRoute || isCalculatingRoute) && { opacity: .45 }]}
                            disabled={!selectedRoute || isCalculatingRoute} onPress={handleStartTrip}>
                            <Text style={styles.pilotStartText}>Iniciar</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  )}
                  {navigation.state.error && (
                    <View accessibilityRole="alert" style={styles.pilotErrorRow}>
                      <Text style={[styles.pilotToolbarSubtitle, mapTheme === 'light' && styles.pilotToolbarSubtitleLight, { flex: 1 }]}>{navigation.state.error}</Text>
                      <TouchableOpacity accessibilityRole="button" style={styles.pilotTextButton}
                        disabled={isPrivacyMode || isCalculatingRoute}
                        onPress={() => selectedDestination && void drawRouteOnMap(selectedDestination.lat, selectedDestination.lng, selectedDestination.name, userLocation ?? undefined, !isTripActive)}>
                        <Text style={[styles.pilotActionText, mapTheme === 'light' && styles.pilotActionTextLight]}>Reintentar</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!isPrivacyMode && progress.offRouteCount >= 3 && (
                    <Text accessibilityLiveRegion="polite" style={[styles.pilotWarningText, mapTheme === 'light' && styles.pilotWarningTextLight]}>
                      {isCalculatingRoute ? 'Fuera de la ruta · recalculando…' : 'Fuera de la ruta · buscando un recorrido válido'}
                    </Text>
                  )}
                  {showMapOptions && (
                    <View style={styles.pilotRouteActions}>
                      <TouchableOpacity accessibilityRole="button" style={styles.pilotTextButton} onPress={handleOpenWazeNavigation}>
                        <Text style={[styles.pilotActionText, mapTheme === 'light' && styles.pilotActionTextLight]}>Abrir Waze</Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button" style={styles.pilotTextButton} onPress={() => { setShowPlanModal(true); setShowMapOptions(false); }}>
                        <Text style={[styles.pilotActionText, mapTheme === 'light' && styles.pilotActionTextLight]}>Cambiar destino</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                </ScrollView>
              )
            )}

            {/* 2. MAPA LEAFLET COMPARTIDO CON LA EXPERIENCIA WEB, SIN CLAVE NATIVA */}
            <View style={styles.mapCard}>
              <LeafletNativeMap
                onUserGesture={() => setFollowUser(false)}
                ref={mapRef}
                style={styles.mapView}
                theme={mapTheme}
                initialRegion={{
                  latitude: navigation.state.camera?.latitude ?? userLocation?.lat ?? DEFAULT_CENTER.lat,
                  longitude: navigation.state.camera?.longitude ?? userLocation?.lng ?? DEFAULT_CENTER.lng,
                  latitudeDelta: navigation.state.camera?.latitudeDelta ?? 0.012,
                  longitudeDelta: navigation.state.camera?.longitudeDelta ?? 0.012,
                }}
                userMarker={!isPrivacyMode && userLocation ? {
                  latitude: isTripActive && currentNavProjection?.isSnappable
                    ? currentNavProjection.snappedCoord.lat
                    : userLocation.lat,
                  longitude: isTripActive && currentNavProjection?.isSnappable
                    ? currentNavProjection.snappedCoord.lng
                    : userLocation.lng,
                  title: isPilot ? (isTripActive ? 'En navegación' : 'Punto de salida') : 'Mi ubicación',
                  description: userAddress || `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`,
                  heading: effectiveHeading,
                  navigating: isTripActive,
                  following: active && followUser && (isPilot || isTripActive) && !isPrivacyMode && !isPinSelectMode && tracking?.locationFresh !== false,
                  routeId: isTripActive && progress.matched ? String(selectedRoute?.id) : undefined,
                  progressMeters: progress.distanceMeters,
                  accuracyMeters: progress.matched ? undefined : tracking?.accuracy ?? undefined,
                } : undefined}
                buses={!isPilot ? realFleetBuses.map((bus) => ({
                  id: bus.placaAutobus,
                  latitude: bus.latitud,
                  longitude: bus.longitud,
                  plate: bus.placaAutobus,
                  driver: bus.nombrePiloto || 'Piloto asignado',
                  route: bus.nombreRuta || 'Ruta principal',
                  speedKmh: bus.velocidadKmh,
                  heading: bus.heading,
                  activeTrip: bus.isTripActive,
                })) : []}
                destination={selectedDestination ? {
                  latitude: selectedDestination.lat,
                  longitude: selectedDestination.lng,
                  title: selectedDestination.name,
                  description: selectedDestination.address,
                } : undefined}
                routes={mapRoutes}
                onBusPress={(plate) => {
                  const bus = realFleetBuses.find((item) => item.placaAutobus === plate);
                  if (bus) setSelectedFloatingBus(bus);
                }}
                onRegionChangeComplete={(region) => {
                  mapCenterCoordsRef.current = { lat: region.latitude, lng: region.longitude };
                  if (active) navigation.setCamera(region);
                }}
              />

              {/* TARJETA FLOTANTE DETALLE RÁPIDO EXACTA A LA WEB APP */}
              {selectedFloatingBus && (
                <View style={styles.floatingSaaSQuickCard}>
                  <View style={styles.quickCardTopRow}>
                    <View style={styles.quickCardAvatar}>
                      <Text style={styles.quickCardAvatarInitial}>
                        {selectedFloatingBus.nombrePiloto?.charAt(0) || 'S'}
                      </Text>
                    </View>

                    <View style={styles.quickCardMetaCol}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.quickCardNameText} numberOfLines={1}>
                          {selectedFloatingBus.nombrePiloto || 'Super Administrador del Sistema'}
                        </Text>
                        <View style={styles.quickCardPilotRoleBadge}>
                          <Text style={styles.quickCardPilotRoleText}>Piloto</Text>
                        </View>
                      </View>
                      <Text style={styles.quickCardRouteText} numberOfLines={1}>
                        Ruta: {selectedFloatingBus.nombreRuta || 'Ruta Principal'} • Autobús: {selectedFloatingBus.placaAutobus}
                      </Text>
                      <Text style={styles.quickCardSpeedText}>
                        Velocidad: {selectedFloatingBus.velocidadKmh || 0} km/h
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={styles.quickCardCloseBtn}
                      onPress={() => setSelectedFloatingBus(null)}
                      activeOpacity={0.7}
                    >
                      <Feather name="x" size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.quickCardBottomRow}>
                    <View style={styles.quickCardStatusPillLive}>
                      <Feather name="radio" size={11} color="#147d62" style={{ marginRight: 4 }} />
                      <Text style={styles.quickCardStatusTextLive}>En Rastreo</Text>
                    </View>

                    <TouchableOpacity
                      style={styles.quickCardTraceRouteBtn}
                      onPress={() => {
                        const dLat = selectedFloatingBus.latitud;
                        const dLng = selectedFloatingBus.longitud;
                        handleSelectDestination({ id: `bus-${selectedFloatingBus.placaAutobus}`, lat: dLat, lng: dLng,
                          name: selectedFloatingBus.nombreRuta || `Ruta ${selectedFloatingBus.placaAutobus}`, address: '', timestamp: Date.now() });
                      }}
                      activeOpacity={0.85}
                    >
                      <Feather name="navigation" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                      <Text style={styles.quickCardTraceRouteText}>Trazar Recorrido</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

                  {/* 🎯 PIN FLOTANTE CENTRAL EN MODO 'FIJA TU DESTINO' */}
                  {isPinSelectMode && (
                    <View style={styles.centerPinContainer} pointerEvents="none">
                      <View style={styles.targetPin}>
                        <View style={styles.targetPinInnerSquare} />
                      </View>
                      <View style={styles.pinVerticalStick} />
                      <View style={styles.pinBlueDotBase} />
                    </View>
                  )}



                  {/* ⚡ CIRCULITO DE VELOCIDAD EN VIVO (ABAJO DEL BOTÓN DE DESACTIVAR UBICACIÓN) */}
                  {isPilot && !isPinSelectMode && (
                    <View style={styles.floatingSpeedometerContainer} pointerEvents="none">
                      <View style={[
                        styles.floatingSpeedometerOuter,
                        currentSpeed > 80 && styles.floatingSpeedometerDanger,
                        currentSpeed > 50 && currentSpeed <= 80 && styles.floatingSpeedometerWarning
                      ]}>
                        <View style={styles.floatingSpeedometerInner}>
                          <Text style={styles.speedometerValueText}>{isPrivacyMode || !userLocation || tracking?.locationFresh === false ? '—' : currentSpeed.toFixed(0)}</Text>
                          <Text style={styles.speedometerUnitText}>km/h</Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {(isPilot || isAdminHeaderCollapsed) && !isPinSelectMode && (
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Centrar mapa en mi ubicación"
                      disabled={isPrivacyMode}
                      style={[styles.floatingGpsCenterBtn, mapTheme === 'light' && styles.floatingGpsCenterBtnLight,
                        isPrivacyMode && { opacity: .45 }]} onPress={handleCenterOnUser}>
                      <Feather name="crosshair" size={23} color={mapTheme === 'light' ? '#17343c' : '#ecf2f3'} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* 3. BARRA INFERIOR DE CONFIRMACIÓN EN MODO 'FIJAR PIN EN EL MAPA' */}
                {isPinSelectMode && (
                  <View style={[styles.bottomPinConfirmContainer, mapTheme === 'light' && styles.bottomPinConfirmContainerLight]}>
                    <View style={styles.pinAddressPreviewRow}>
                      <View style={styles.pinIconSmall}>
                        <Feather
                          name={isAddingLocationToSaved ? "bookmark" : "map-pin"}
                          size={15}
                          color={isAddingLocationToSaved ? "#f59e0b" : "#d85f28"}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pinConfirmTitle, mapTheme === 'light' && styles.pinConfirmTitleLight]} numberOfLines={1}>
                          {isAddingLocationToSaved ? 'Guardar Nueva Ubicación' : (destinationSearch.trim() || 'Punto fijado en el mapa')}
                        </Text>
                        <Text style={[styles.pinConfirmSubtitle, mapTheme === 'light' && styles.pinConfirmSubtitleLight]} numberOfLines={1}>
                          {isAddingLocationToSaved
                            ? 'Mueve el mapa para posicionar el pin y escribe el nombre'
                            : 'Mueve el mapa para ajustar la posición exacta'}
                        </Text>
                      </View>
                    </View>

                    {isAddingLocationToSaved && (
                      <TextInput
                        style={[styles.savedLocationNameInput, mapTheme === 'light' && styles.savedLocationNameInputLight]}
                        placeholder="Nombre del lugar (Ej: Taller Central, Parada Norte)..."
                        placeholderTextColor={mapTheme === 'light' ? '#71717a' : '#94a3b8'}
                        value={customPinName}
                        onChangeText={setCustomPinName}
                        autoFocus={true}
                      />
                    )}

                    <View style={styles.pinConfirmButtonsRow}>
                      <TouchableOpacity
                        style={[styles.pinCancelBtn, mapTheme === 'light' && styles.pinCancelBtnLight]}
                        onPress={() => {
                          setIsPinSelectMode(false);
                          setIsAddingLocationToSaved(false);
                          setCustomPinName('');
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.pinCancelBtnText, mapTheme === 'light' && styles.pinCancelBtnTextLight]}>Cancelar</Text>
                      </TouchableOpacity>

                      {isAddingLocationToSaved ? (
                        <TouchableOpacity
                          style={[styles.pinConfirmBtn, { backgroundColor: '#eab308' }]}
                          onPress={handleSaveCurrentPinLocation}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.pinConfirmBtnText, { color: '#000000', fontWeight: '900' }]}>⭐ Guardar Ubicación</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.pinConfirmBtn}
                          onPress={handleConfirmPinDestination}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.pinConfirmBtnText}>Fijar este Destino</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              </>
            )}

        {/* 4. MODAL PRINCIPAL: PLANIFICA TU VIAJE (ROBUSTO Y SIN BLOQUEOS) */}
        <Modal visible={active && showPlanModal} animationType="slide" transparent={true} onRequestClose={() => setShowPlanModal(false)}>
          <SafeAreaView style={styles.planModalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ flex: 1, justifyContent: 'flex-end' }}
            >
              {/* Tocar el fondo superior translúcido oculta el teclado */}
              <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                <View style={{ flex: 1 }} />
              </TouchableWithoutFeedback>

              <View style={[styles.planModalCard, mapTheme === 'light' && styles.planModalCardLight]}>
                {/* Tocar cabecera, tirador o títulos del panel oculta el teclado */}
                <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                  <View>
                    {/* Tirador visual superior */}
                    <View style={styles.modalDragIndicatorWrapper}>
                      <View style={[styles.modalDragIndicator, mapTheme === 'light' && styles.modalDragIndicatorLight]} />
                    </View>
                    
                    {/* Banner Superior en Vivo del Destino Ingresado (Para Piloto) */}
                    {isPilot && destinationSearch.trim().length > 0 && (
                      <View style={styles.pilotLiveInputBanner}>
                        <View style={styles.pilotLiveInputBadge}>
                          <View style={styles.pilotLiveInputDot} />
                          <Text style={styles.pilotLiveInputBadgeText}>ENTRADA EN VIVO</Text>
                        </View>
                        <Text style={styles.pilotLiveInputText} numberOfLines={1}>
                          Destino actual: "{destinationSearch.trim()}"
                        </Text>
                      </View>
                    )}

                    <View style={styles.planModalHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={styles.planModalHeaderIconSquare}>
                          <Feather name="navigation" size={16} color="#d85f28" />
                        </View>
                        <Text style={[styles.planModalTitle, mapTheme === 'light' && styles.planModalTitleLight]}>
                          Planifica tu viaje
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => setShowPlanModal(false)} style={styles.closeModalCircleBtn} activeOpacity={0.7}>
                        <Feather name="x" size={16} color={mapTheme === 'light' ? '#64748b' : '#94a3b8'} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableWithoutFeedback>

                {/* Caja Dinámica de Salida (En Vivo) y Destino */}
                <View style={[styles.routeInputsBox, mapTheme === 'light' && styles.routeInputsBoxLight]}>
                  <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                    <View style={styles.inputWithDotRow}>
                      <View style={styles.originBlueDot} />
                      <TextInput
                        style={[styles.originTextInput, mapTheme === 'light' && styles.originTextInputLight]}
                        value={originInputText.replace(/^📍\s*/, '')}
                        editable={false}
                      />
                    </View>
                  </TouchableWithoutFeedback>

                  <View style={styles.verticalInputConnector} />

                  <View style={styles.inputWithDotRow}>
                    <View style={styles.destPurpleSquare} />
                    <TextInput
                      style={[styles.destTextInput, mapTheme === 'light' && styles.destTextInputLight]}
                      placeholder="Busca una ruta, destino o dirección..."
                      placeholderTextColor={mapTheme === 'light' ? '#71717a' : '#64748b'}
                      value={destinationSearch}
                      onChangeText={handleDestinationSearchChange}
                      autoFocus={true}
                      returnKeyType="search"
                      onSubmitEditing={Keyboard.dismiss}
                    />
                    {destinationSearch.length > 0 && (
                      <TouchableOpacity onPress={() => handleDestinationSearchChange('')} style={styles.clearSearchInputBtn}>
                        <Feather name="x" size={14} color="#94a3b8" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Botón rápido: Fijar en el mapa */}
                <TouchableOpacity
                  style={[styles.fixOnMapQuickBtn, mapTheme === 'light' && styles.fixOnMapQuickBtnLight]}
                  onPress={() => {
                    setShowPlanModal(false);
                    setIsPinSelectMode(true);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.fixOnMapIconBox}>
                    <Feather name="crosshair" size={16} color="#d85f28" />
                  </View>
                  <Text style={[styles.fixOnMapQuickText, mapTheme === 'light' && styles.fixOnMapQuickTextLight]}>
                    Fijar ubicación personalizada en el mapa
                  </Text>
                  <Feather name="chevron-right" size={15} color="#64748b" style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>

                {/* Botón rápido: Ubicaciones Guardadas */}
                <TouchableOpacity
                  style={[styles.savedLocationsQuickBtn, mapTheme === 'light' && styles.savedLocationsQuickBtnLight]}
                  onPress={() => {
                    setShowPlanModal(false);
                    setShowSavedPlacesModal(true);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <View style={[styles.savedIconCircle, mapTheme === 'light' && styles.savedIconCircleLight]}>
                      <Feather name="bookmark" size={16} color="#f59e0b" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.savedLocationsQuickTitle, mapTheme === 'light' && styles.savedLocationsQuickTitleLight]}>
                        Ubicaciones Guardadas ({savedFavorites.length})
                      </Text>
                      <Text style={[styles.savedLocationsQuickSub, mapTheme === 'light' && styles.savedLocationsQuickSubLight]} numberOfLines={1}>
                        Tus paradas, terminales y puntos frecuentes
                      </Text>
                    </View>
                  </View>
                  <Feather name="chevron-right" size={16} color="#d85f28" />
                </TouchableOpacity>

                {/* Contenido del Modal: Rutas Top, Coincidencias de Búsqueda o Historial */}
                <ScrollView
                  style={styles.placesScrollView}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  onScrollBeginDrag={Keyboard.dismiss}
                  showsVerticalScrollIndicator={false}
                >
                  {isSearchingPlaces ? (
                    <View style={styles.searchingBox}>
                      <ActivityIndicator size="small" color="#d85f28" />
                      <Text style={styles.searchingText}>Buscando rutas y direcciones...</Text>
                    </View>
                  ) : searchSuggestions.length > 0 ? (
                    <View style={{ gap: 8 }}>
                      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                        <View>
                          <Text style={[styles.sectionTitle, mapTheme === 'light' && styles.sectionTitleLight]}>
                            Ubicaciones y Rutas Encontradas
                          </Text>
                        </View>
                      </TouchableWithoutFeedback>
                      {searchSuggestions.map((place) => (
                        <TouchableOpacity
                          key={place.id}
                          style={[
                            styles.suggestionItemRow,
                            place.isPredefinedRoute && styles.suggestionItemRouteHighlight,
                            mapTheme === 'light' && styles.suggestionItemRowLight
                          ]}
                          onPress={() => handleSelectDestination(place)}
                          activeOpacity={0.75}
                        >
                          <View style={[styles.placeIconSquare, place.isPredefinedRoute && styles.placeIconSquareRoute, mapTheme === 'light' && styles.placeIconSquareLight]}>
                            {place.isPredefinedRoute ? (
                              <MaterialCommunityIcons name="bus" size={18} color="#ff9b6c" />
                            ) : (
                              <Feather name="map-pin" size={16} color="#3b82f6" />
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <Text style={[styles.suggestionName, mapTheme === 'light' && styles.suggestionNameLight, { flex: 1 }]} numberOfLines={1}>
                                {place.name}
                              </Text>
                              {place.distanceKm !== undefined && (
                                <View style={styles.placeDistanceBadge}>
                                  <Text style={styles.placeDistanceBadgeText}>
                                    {place.distanceKm < 1 ? `${Math.round(place.distanceKm * 1000)} m` : `${place.distanceKm} km`}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={[styles.suggestionAddress, mapTheme === 'light' && styles.suggestionAddressLight]} numberOfLines={1}>
                              {place.placeType ? `${place.placeType} • ` : ''}{place.address}
                            </Text>
                          </View>
                          <Feather name="chevron-right" size={16} color="#d85f28" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <View>
                      {/* SECCIÓN: RUTAS MÁS USADAS DE LA ÚLTIMA SEMANA (SIN CÍRCULO CON NÚMERO) */}
                      <View style={styles.topRoutesSection}>
                        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                          <View style={styles.topRoutesSectionHeader}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Feather name="trending-up" size={14} color="#d85f28" />
                              <Text style={styles.topRoutesSectionTitle}>3 Rutas Más Usadas Esta Semana</Text>
                            </View>
                            <View style={styles.topRoutesBadge}>
                              <Text style={styles.topRoutesBadgeText}>Últimos 7 días</Text>
                            </View>
                          </View>
                        </TouchableWithoutFeedback>

                        <View style={styles.topRoutesList}>
                          {TOP_WEEKLY_ROUTES.map((route) => (
                            <TouchableOpacity
                              key={route.id}
                              style={[styles.topRouteCard, mapTheme === 'light' && styles.topRouteCardLight]}
                              onPress={() => handleSelectDestination({
                                id: route.id,
                                name: route.name,
                                address: `${route.distKm} km · ~${route.avgDurationMin} min`,
                                lat: route.destLat,
                                lng: route.destLng,
                                distanceKm: route.distKm,
                                isPredefinedRoute: true,
                                timestamp: Date.now(),
                              })}
                              activeOpacity={0.75}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.topRouteCardName, mapTheme === 'light' && styles.topRouteCardNameLight]} numberOfLines={1}>
                                  {route.name}
                                </Text>
                                <View style={styles.topRouteMetricsRow}>
                                  <View style={styles.metricPill}>
                                    <Feather name="navigation" size={10} color="#60a5fa" style={{ marginRight: 3 }} />
                                    <Text style={styles.topRouteMetricItem}>{route.distKm} km</Text>
                                  </View>
                                  <View style={styles.metricPill}>
                                    <Feather name="clock" size={10} color="#94a3b8" style={{ marginRight: 3 }} />
                                    <Text style={styles.topRouteMetricItem}>~{route.avgDurationMin} min</Text>
                                  </View>
                                  <View style={[styles.metricPill, styles.metricPillHighlight]}>
                                    <Feather name="repeat" size={10} color="#f59e0b" style={{ marginRight: 3 }} />
                                    <Text style={styles.topRouteMetricHighlight}>{route.usageCount} viajes</Text>
                                  </View>
                                </View>
                              </View>
                              <Feather name="chevron-right" size={16} color="#d85f28" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {/* Lugares Recientes */}
                      {locationHistory.length > 0 && (
                        <View style={styles.historySection}>
                          <Text style={[styles.sectionTitle, mapTheme === 'light' && styles.sectionTitleLight]}>
                            Búsquedas Recientes
                          </Text>
                          {locationHistory.map((item) => (
                            <TouchableOpacity
                              key={item.id}
                              style={[styles.suggestionItemRow, mapTheme === 'light' && styles.suggestionItemRowLight]}
                              onPress={() => handleSelectDestination(item)}
                              activeOpacity={0.75}
                            >
                              <View style={[styles.placeIconSquare, mapTheme === 'light' && styles.placeIconSquareLight]}>
                                <Feather name="clock" size={15} color="#94a3b8" />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.suggestionName, mapTheme === 'light' && styles.suggestionNameLight]} numberOfLines={1}>
                                  {item.name}
                                </Text>
                                <Text style={[styles.suggestionAddress, mapTheme === 'light' && styles.suggestionAddressLight]} numberOfLines={1}>
                                  {item.address}
                                </Text>
                              </View>
                              <Feather name="chevron-right" size={14} color="#64748b" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

        {/* MODAL EXCLUSIVO: UBICACIONES GUARDADAS / FAVORITOS */}
        <Modal visible={active && showSavedPlacesModal} animationType="slide" transparent={true} onRequestClose={() => setShowSavedPlacesModal(false)}>
          <SafeAreaView style={styles.planModalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ flex: 1, justifyContent: 'flex-end' }}
            >
              <View style={[styles.planModalCard, mapTheme === 'light' && styles.planModalCardLight]}>
                <View style={styles.planModalHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[styles.savedIconCircle, mapTheme === 'light' && styles.savedIconCircleLight]}>
                      <Feather name="bookmark" size={18} color="#f59e0b" />
                    </View>
                    <View>
                      <Text style={[styles.planModalTitle, mapTheme === 'light' && styles.planModalTitleLight]}>
                        Ubicaciones Guardadas
                      </Text>
                      <Text style={{ color: '#71717a', fontSize: 12, marginTop: 1 }}>
                        Puntos frecuentes y paradas personalizadas
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setShowSavedPlacesModal(false)} style={styles.closeModalCircleBtn} activeOpacity={0.7}>
                    <Feather name="x" size={16} color={mapTheme === 'light' ? '#64748b' : '#94a3b8'} />
                  </TouchableOpacity>
                </View>

                {/* Botón Destacado: Agregar Ubicación Nueva en el Mapa */}
                <TouchableOpacity
                  style={[styles.addNewSavedPlaceBtn, mapTheme === 'light' && styles.addNewSavedPlaceBtnLight]}
                  onPress={() => {
                    setShowSavedPlacesModal(false);
                    setShowPlanModal(false);
                    setIsAddingLocationToSaved(true);
                    setIsPinSelectMode(true);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={styles.addNewPlacePlusCircle}>
                    <Feather name="plus" size={16} color="#ffffff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addNewPlaceTitle}>Agregar ubicación nueva</Text>
                    <Text style={styles.addNewPlaceSub}>Toca aquí para elegir el punto exacto en el mapa</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color="#d85f28" />
                </TouchableOpacity>

                {/* Lista de Ubicaciones Guardadas */}
                <ScrollView style={{ maxHeight: 380, marginTop: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {/* SECCIÓN PRINCIPAL: TODAS LAS UBICACIONES GUARDADAS */}
                  <View style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <Feather name="bookmark" size={14} color="#f59e0b" />
                      <Text style={[styles.sectionTitle, mapTheme === 'light' && styles.sectionTitleLight]}>
                        Ubicaciones Guardadas ({savedFavorites.length})
                      </Text>
                    </View>

                    {savedFavorites.length === 0 ? (
                      <View style={styles.emptySavedPlacesBox}>
                        <Feather name="map-pin" size={28} color="#64748b" style={{ marginBottom: 8 }} />
                        <Text style={[styles.emptySavedPlacesText, mapTheme === 'light' && styles.emptySavedPlacesTextLight]}>
                          Aún no tienes ubicaciones guardadas
                        </Text>
                        <Text style={styles.emptySavedPlacesSub}>
                          Presiona "Agregar ubicación nueva" para marcar tus puntos en el mapa.
                        </Text>
                      </View>
                    ) : (
                      <View style={{ gap: 8 }}>
                        {savedFavorites.map((fav) => {
                          const userLat = userLocation?.lat || DEFAULT_CENTER.lat;
                          const userLng = userLocation?.lng || DEFAULT_CENTER.lng;
                          const dist = getDistanceKm(userLat, userLng, fav.lat, fav.lng);

                          return (
                            <View
                              key={fav.id}
                              style={[styles.savedPlaceCardItem, mapTheme === 'light' && styles.savedPlaceCardItemLight]}
                            >
                              <TouchableOpacity
                                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                                onPress={() => handleSelectDestination(fav)}
                                activeOpacity={0.75}
                              >
                                <View style={[styles.savedPlaceIconBox, mapTheme === 'light' && styles.savedPlaceIconBoxLight]}>
                                  <Feather name="bookmark" size={16} color="#f59e0b" />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.savedPlaceNameText, mapTheme === 'light' && styles.savedPlaceNameTextLight]} numberOfLines={1}>
                                    {fav.name}
                                  </Text>
                                  <Text style={[styles.savedPlaceAddressText, mapTheme === 'light' && styles.savedPlaceAddressTextLight]} numberOfLines={1}>
                                    {fav.address}
                                  </Text>
                                  <Text style={styles.savedPlaceDistText}>
                                    {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist} km`} de tu posición
                                  </Text>
                                </View>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.deleteSavedPlaceBtn}
                                onPress={() => handleDeleteSavedLocation(fav.id)}
                                activeOpacity={0.7}
                              >
                                <Feather name="trash-2" size={13} color="#ef4444" />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {/* SECCIÓN SECUNDARIA: ÚLTIMOS VIAJES INICIADOS */}
                  {recentStartedTrips.length > 0 && (
                    <View style={{ marginBottom: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name="clock" size={14} color="#3b82f6" />
                          <Text style={[styles.sectionTitle, mapTheme === 'light' && styles.sectionTitleLight]}>
                            Últimos Viajes Iniciados ({recentStartedTrips.length} en 7 días)
                          </Text>
                        </View>
                        <View style={styles.topRoutesBadge}>
                          <Text style={styles.topRoutesBadgeText}>Últimos 7 días</Text>
                        </View>
                      </View>
                      <View style={{ gap: 6 }}>
                        {recentStartedTrips.slice(0, 3).map((trip, idx) => (
                          <TouchableOpacity
                            key={`modal-recent-${trip.id || idx}`}
                            style={[styles.savedPlaceCardItem, { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.08)' }]}
                            onPress={() => handleSelectDestination(trip)}
                            activeOpacity={0.75}
                          >
                            <View style={[styles.savedPlaceIconBox, { backgroundColor: '#1d4ed8' }]}>
                              <Feather name="navigation" size={15} color="#ffffff" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.savedPlaceNameText, mapTheme === 'light' && styles.savedPlaceNameTextLight]} numberOfLines={1}>
                                {trip.name}
                              </Text>
                              <Text style={[styles.savedPlaceAddressText, mapTheme === 'light' && styles.savedPlaceAddressTextLight]} numberOfLines={1}>
                                {trip.address}
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                <Feather name="clock" size={10} color="#60a5fa" />
                                <Text style={{ color: '#60a5fa', fontSize: 10, fontWeight: '700' }}>
                                  {formatRelativeTime(trip.timestamp || Date.now())}
                                </Text>
                              </View>
                            </View>
                            <View style={[styles.quickStartTripMiniBtn, { backgroundColor: '#2563eb' }]}>
                              <Text style={styles.quickStartTripMiniBtnText}>Trazar</Text>
                              <Feather name="arrow-right" size={11} color="#ffffff" />
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

        <Modal visible={active && showServerRouteModal} transparent={true} animationType="fade" onRequestClose={() => setShowServerRouteModal(false)}>
          <KeyboardAvoidingView style={styles.serverRouteModalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.serverRouteModalCard, mapTheme === 'light' && styles.serverRouteModalCardLight]}>
                <View style={styles.serverRouteModalHeader}>
                  <View style={styles.serverRouteModalIcon}>
                    <Feather name="bookmark" size={20} color="#d85f28" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.serverRouteModalEyebrow, mapTheme === 'light' && styles.serverRouteModalEyebrowLight]}>RUTA FRECUENTE</Text>
                    <Text style={[styles.serverRouteModalTitle, mapTheme === 'light' && styles.serverRouteModalTitleLight]}>Guardar recorrido</Text>
                  </View>
                  <TouchableOpacity onPress={() => setShowServerRouteModal(false)} style={styles.serverRouteModalClose} disabled={savingServerRoute}>
                    <Feather name="x" size={18} color={mapTheme === 'light' ? '#64748b' : '#cbd5e1'} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.serverRoutePathCard, mapTheme === 'light' && styles.serverRoutePathCardLight]}>
                  <View style={styles.serverRoutePathRow}>
                    <View style={styles.serverRouteOriginDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serverRoutePathLabel}>DESDE</Text>
                      <Text style={[styles.serverRoutePathValue, mapTheme === 'light' && styles.serverRoutePathValueLight]} numberOfLines={2}>{userAddress || 'Ubicación actual'}</Text>
                    </View>
                  </View>
                  <View style={styles.serverRoutePathLine} />
                  <View style={styles.serverRoutePathRow}>
                    <View style={styles.serverRouteDestinationDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serverRoutePathLabel}>HASTA</Text>
                      <Text style={[styles.serverRoutePathValue, mapTheme === 'light' && styles.serverRoutePathValueLight]} numberOfLines={2}>{selectedDestination?.name}</Text>
                    </View>
                  </View>
                </View>

                <Text style={[styles.serverRouteInputLabel, mapTheme === 'light' && styles.serverRouteInputLabelLight]}>Nombre de la ruta</Text>
                <TextInput
                  value={serverRouteName}
                  onChangeText={setServerRouteName}
                  maxLength={100}
                  autoFocus
                  placeholder="Ej. Terminal - Centro"
                  placeholderTextColor="#64748b"
                  style={[styles.serverRouteInput, mapTheme === 'light' && styles.serverRouteInputLight]}
                />
                {serverRouteError && <Text style={styles.serverRouteErrorText}>{serverRouteError}</Text>}

                <View style={styles.serverRouteModalActions}>
                  <TouchableOpacity style={[styles.serverRouteCancelBtn, mapTheme === 'light' && styles.serverRouteCancelBtnLight]} onPress={() => setShowServerRouteModal(false)} disabled={savingServerRoute}>
                    <Text style={[styles.serverRouteCancelBtnText, mapTheme === 'light' && styles.serverRouteCancelBtnTextLight]}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.serverRouteSaveBtn, (savingServerRoute || serverRouteName.trim().length < 2) && styles.serverRouteSaveBtnDisabled]}
                    onPress={() => void saveServerRoute()}
                    disabled={savingServerRoute || serverRouteName.trim().length < 2}
                  >
                    {savingServerRoute ? <ActivityIndicator size="small" color="#ffffff" /> : <Feather name="save" size={14} color="#ffffff" />}
                    <Text style={styles.serverRouteSaveBtnText}>{savingServerRoute ? 'Guardando…' : 'Guardar ruta'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        {/* 5. MODAL PARA DETENER SOLO LA NAVEGACIÓN; EL VIAJE SIGUE ACTIVO */}
        <Modal visible={active && showCancelTripModal} transparent={true} animationType="fade" onRequestClose={handleDismissCancelTrip}>
          <DialogViewport>
            <View style={[styles.cancelTripModalCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.cancelTripIconCircle}>
                <Feather name="alert-octagon" size={26} color="#ef4444" />
              </View>
              <Text style={[styles.cancelTripModalTitle, { color: colors.ink }]}>¿Detener la guía de navegación?</Text>
              <Text style={[styles.cancelTripModalDescription, { color: colors.muted }]}>
                {tracking?.assignedTrip ? 'Se ocultará la guía. Tu viaje asignado seguirá compartiendo ubicación hasta que lo finalices en Telemetría.' : 'Se ocultará la guía local. Tu ubicación no se está compartiendo con despacho.'}
              </Text>
              <View style={styles.cancelTripModalButtonsRow}>
                <TouchableOpacity
                  style={[styles.cancelTripModalKeepBtn, { backgroundColor: colors.surfaceSoft }]}
                  onPress={handleDismissCancelTrip}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.cancelTripModalKeepBtnText, { color: colors.ink }]}>Seguir navegando</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelTripModalConfirmBtn}
                  onPress={handleConfirmCancelTrip}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelTripModalConfirmBtnText}>Detener guía</Text>
                </TouchableOpacity>
              </View>
            </View>
          </DialogViewport>
        </Modal>

        {/* 5.1 MODAL DE LLEGADA A DESTINO: ¿DESEAS TERMINAR EL VIAJE? */}
        <Modal visible={active && !isPrivacyMode && showArrivalModal} transparent={true} animationType="fade" onRequestClose={() => !finishingTrip && handleCancelArrivalModal()}>
          <DialogViewport>
            <View style={[styles.arrivalModalCard, mapTheme === 'light' && styles.arrivalModalCardLight]}>
              <View style={styles.arrivalIconCircle}>
                <Feather name="check-circle" size={30} color="#147d62" />
              </View>

              <Text style={[styles.arrivalModalTitle, mapTheme === 'light' && styles.arrivalModalTitleLight]}>
                ¡Has llegado a tu destino!
              </Text>

              <Text style={[styles.arrivalModalQuestion, mapTheme === 'light' && styles.arrivalModalQuestionLight]}>
                {tracking?.assignedTrip ? '¿Deseas finalizar el viaje asignado?' : '¿Deseas terminar la guía local?'}
              </Text>

              {selectedDestination && (
                <View style={[styles.arrivalDestinationCard, mapTheme === 'light' && styles.arrivalDestinationCardLight]}>
                  <View style={styles.arrivalPinSquare}>
                    <Feather name="map-pin" size={16} color="#3b82f6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.arrivalDestinationName, mapTheme === 'light' && styles.arrivalDestinationNameLight]} numberOfLines={1}>
                      {selectedDestination.name}
                    </Text>
                    <Text style={[styles.arrivalDestinationAddress, mapTheme === 'light' && styles.arrivalDestinationAddressLight]} numberOfLines={1}>
                      {selectedDestination.address}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={[styles.arrivalModalHint, mapTheme === 'light' && styles.arrivalModalHintLight]}>
                Si cancelas por error, este aviso volverá a aparecer en 30 segundos mientras permanezcas en el destino.
              </Text>

              <View style={styles.arrivalModalButtonsRow}>
                <TouchableOpacity
                  style={[styles.arrivalCancelBtn, mapTheme === 'light' && styles.arrivalCancelBtnLight]}
                  onPress={handleCancelArrivalModal}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.arrivalCancelBtnText, mapTheme === 'light' && styles.arrivalCancelBtnTextLight]}>
                    Cancelar
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.arrivalFinishBtn}
                  onPress={() => void handleFinishTripFromArrivalModal()}
                  disabled={finishingTrip}
                  activeOpacity={0.85}
                >
                  <Feather name="check" size={15} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.arrivalFinishBtnText}>
                    {finishingTrip ? 'Finalizando...' : tracking?.assignedTrip && navigation.state.assignedTripId === tracking.assignedTrip.idViaje ? 'Finalizar viaje asignado' : 'Terminar guía personal'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </DialogViewport>
        </Modal>

        {/* 6. MODAL DE FLOTA COMPLETA (ADMINISTRADOR) */}
        <Modal
          visible={active && showFleetModal}
          transparent={true}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={closeFleetModal}
        >
          <SafeAreaView style={styles.fleetModalOverlay} edges={['left', 'right']}>
            <TouchableWithoutFeedback onPress={closeFleetModal} accessibilityRole="button" accessibilityLabel="Cerrar flota">
              <View style={styles.fleetModalDismissArea} />
            </TouchableWithoutFeedback>

            <KeyboardAvoidingView
              style={styles.fleetModalKeyboardArea}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              pointerEvents="box-none"
            >
              <View style={[
                styles.fleetModalCard,
                mapTheme === 'light' && styles.fleetModalCardLight,
                {
                  maxHeight: Math.min(viewportHeight - insets.top - 12, 620),
                  paddingBottom: Math.max(18, insets.bottom + 12),
                },
              ]}>
                <View style={[styles.fleetModalHandle, mapTheme === 'light' && styles.fleetModalHandleLight]} />

                <View style={styles.fleetModalHeader}>
                  <View style={[styles.fleetModalHeaderIcon, mapTheme === 'light' && styles.fleetModalHeaderIconLight]}>
                    <MaterialCommunityIcons name="bus" size={20} color="#d85f28" />
                  </View>
                  <View style={styles.fleetModalHeaderCopy}>
                    <Text numberOfLines={1} style={[styles.fleetModalTitle, mapTheme === 'light' && styles.fleetModalTitleLight]}>
                      Autobuses en ruta
                    </Text>
                    <Text numberOfLines={1} style={[styles.fleetModalSubtitle, mapTheme === 'light' && styles.fleetModalSubtitleLight]}>
                      {realFleetBuses.length === 0
                        ? 'No hay unidades transmitiendo'
                        : `${realFleetBuses.length} ${realFleetBuses.length === 1 ? 'unidad activa' : 'unidades activas'}`}
                    </Text>
                  </View>
                  <View style={[styles.fleetModalCountBadge, mapTheme === 'light' && styles.fleetModalCountBadgeLight]}>
                    <Text style={styles.fleetModalCountText}>{realFleetBuses.length}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={closeFleetModal}
                    style={[styles.fleetModalCloseButton, mapTheme === 'light' && styles.fleetModalCloseButtonLight]}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Cerrar flota"
                  >
                    <Feather name="x" size={20} color={mapTheme === 'light' ? '#334155' : '#ffffff'} />
                  </TouchableOpacity>
                </View>

                {realFleetBuses.length > 0 ? (
                  <>
                    <View style={[styles.fleetSearchBox, mapTheme === 'light' && styles.fleetSearchBoxLight]}>
                      <Feather name="search" size={17} color={mapTheme === 'light' ? '#64748b' : '#94a3b8'} />
                      <TextInput
                        style={[styles.fleetSearchInput, mapTheme === 'light' && styles.fleetSearchInputLight]}
                        placeholder="Buscar placa, piloto o ruta"
                        placeholderTextColor={mapTheme === 'light' ? '#64748b' : '#94a3b8'}
                        value={fleetSearchFilter}
                        onChangeText={setFleetSearchFilter}
                        returnKeyType="search"
                      />
                      {fleetSearchFilter.length > 0 ? (
                        <TouchableOpacity
                          onPress={() => setFleetSearchFilter('')}
                          style={styles.fleetSearchClearButton}
                          accessibilityRole="button"
                          accessibilityLabel="Limpiar búsqueda"
                        >
                          <Feather name="x" size={15} color={mapTheme === 'light' ? '#64748b' : '#94a3b8'} />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {filteredBuses.length === 0 ? (
                      <View style={[styles.fleetEmptyState, styles.fleetSearchEmptyState, mapTheme === 'light' && styles.fleetEmptyStateLight]}>
                        <View style={[styles.fleetEmptyIcon, mapTheme === 'light' && styles.fleetEmptyIconLight]}>
                          <Feather name="search" size={23} color="#d85f28" />
                        </View>
                        <Text style={[styles.fleetEmptyTitle, mapTheme === 'light' && styles.fleetEmptyTitleLight]}>
                          No encontramos coincidencias
                        </Text>
                        <Text style={[styles.fleetEmptyMessage, mapTheme === 'light' && styles.fleetEmptyMessageLight]}>
                          Prueba con otra placa, nombre de piloto o ruta.
                        </Text>
                      </View>
                    ) : (
                      <>
                        <ScrollView
                          style={[styles.fleetModalList, { maxHeight: Math.min(viewportHeight * 0.48, 420) }]}
                          contentContainerStyle={styles.fleetModalListContent}
                          showsVerticalScrollIndicator={false}
                          keyboardShouldPersistTaps="handled"
                        >
                          {filteredBuses.map((bus) => {
                            const spdColor = bus.velocidadKmh > 80 ? '#ef4444' : (bus.velocidadKmh > 50 ? '#f59e0b' : '#147d62');
                            return (
                              <TouchableOpacity
                                key={bus.placaAutobus}
                                style={[styles.fleetBusItemCard, mapTheme === 'light' && styles.fleetBusItemCardLight]}
                                onPress={() => handleFocusBus(bus)}
                                activeOpacity={0.78}
                              >
                                <View style={[styles.fleetBusItemIcon, mapTheme === 'light' && styles.fleetBusItemIconLight]}>
                                  <MaterialCommunityIcons name="bus" size={20} color="#d85f28" />
                                </View>
                                <View style={styles.fleetBusItemCopy}>
                                  <Text numberOfLines={1} style={[styles.fleetBusItemPlate, mapTheme === 'light' && styles.fleetBusItemPlateLight]}>
                                    {bus.placaAutobus}
                                  </Text>
                                  <Text numberOfLines={1} style={[styles.fleetBusItemPilot, mapTheme === 'light' && styles.fleetBusItemPilotLight]}>
                                    {bus.nombrePiloto || 'Sin piloto identificado'}
                                  </Text>
                                  <Text numberOfLines={1} style={[styles.fleetBusItemRoute, mapTheme === 'light' && styles.fleetBusItemRouteLight]}>
                                    {bus.nombreRuta || 'Sin ruta asignada'}
                                  </Text>
                                </View>
                                <View style={styles.fleetBusItemAside}>
                                  <View style={[styles.fleetBusItemSpeedBadge, { backgroundColor: spdColor }]}>
                                    <Text style={styles.fleetBusItemSpeedText}>{Math.max(0, Math.round(bus.velocidadKmh || 0))} km/h</Text>
                                  </View>
                                  <Feather name="chevron-right" size={18} color={mapTheme === 'light' ? '#94a3b8' : '#64748b'} />
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                        <Text style={[styles.fleetModalHint, mapTheme === 'light' && styles.fleetModalHintLight]}>
                          Toca una unidad para centrarla en el mapa
                        </Text>
                      </>
                    )}
                  </>
                ) : (
                  <View style={[styles.fleetEmptyState, mapTheme === 'light' && styles.fleetEmptyStateLight]}>
                    <View style={[styles.fleetEmptyIcon, mapTheme === 'light' && styles.fleetEmptyIconLight]}>
                      <MaterialCommunityIcons name="bus-stop" size={28} color="#d85f28" />
                    </View>
                    <Text style={[styles.fleetEmptyTitle, mapTheme === 'light' && styles.fleetEmptyTitleLight]}>
                      Sin ubicaciones recientes
                    </Text>
                    <Text style={[styles.fleetEmptyMessage, mapTheme === 'light' && styles.fleetEmptyMessageLight]}>
                      Cuando un piloto inicie su recorrido, la unidad aparecerá aquí en tiempo real.
                    </Text>
                  </View>
                )}
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

        {/* 7. MODAL DE RECORDATORIO: ACTIVAR UBICACIÓN PARA SALIR A RUTA */}
        <Modal visible={active && showPrivacyReminderModal} transparent={true} animationType="fade" onRequestClose={() => setShowPrivacyReminderModal(false)}>
          <DialogViewport>
            <View style={[styles.reminderModalCard, mapTheme === 'light' && styles.reminderModalCardLight]}>
              <View style={styles.reminderIconCircle}>
                <Feather name="shield" size={30} color="#f59e0b" />
              </View>
              <Text style={[styles.reminderTitle, mapTheme === 'light' && styles.reminderTitleLight]}>
                Ubicación en Modo Privacidad
              </Text>
              <Text style={[styles.reminderDescription, mapTheme === 'light' && styles.reminderDescriptionLight]}>
                Tu GPS se encuentra desconectado para proteger tu privacidad. Para calcular la ruta y registrar tu viaje en tiempo real, necesitas activar tu ubicación laboral.
              </Text>
              <View style={styles.reminderButtonsCol}>
                <TouchableOpacity
                  style={styles.reminderActivateBtn}
                  onPress={handleConfirmActivateFromReminder}
                  activeOpacity={0.85}
                >
                  <Feather name="play" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.reminderActivateBtnText}>Activar GPS e iniciar navegación</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.reminderDismissBtn, mapTheme === 'light' && styles.reminderDismissBtnLight]}
                  onPress={() => setShowPrivacyReminderModal(false)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.reminderDismissBtnText, mapTheme === 'light' && styles.reminderDismissBtnTextLight]}>
                    Continuar en Privado / Cancelar
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </DialogViewport>
        </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  pilotToolbar: { backgroundColor: '#102229', paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  pilotToolbarLight: { backgroundColor: '#ffffff' },
  pilotToolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pilotToolbarCopy: { flex: 1, minWidth: 0 },
  pilotToolbarTitle: { color: '#ecf2f3', fontSize: 16, fontWeight: '700' },
  pilotToolbarTitleLight: { color: '#17343c' },
  pilotToolbarSubtitle: { color: '#b8c9cd', fontSize: 13, lineHeight: 19, marginTop: 3 },
  pilotToolbarSubtitleLight: { color: '#53666b' },
  pilotSearchButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pilotOptionsButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pilotRouteActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  pilotRouteChoices: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pilotRemaining: { flex: 1, minWidth: 120, fontSize: 12, color: '#b8c9cd' },
  pilotTextButton: { minHeight: 48, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  pilotActionText: { fontSize: 13, color: '#ff9b6c', fontWeight: '700' },
  pilotActionTextLight: { color: '#b9481b' },
  pilotStopText: { fontSize: 13, color: '#f27b7b', fontWeight: '700' },
  pilotStopTextLight: { color: '#b73a45' },
  pilotStartButton: { minHeight: 48, paddingHorizontal: 20, borderRadius: 12, backgroundColor: '#b9481b', alignItems: 'center', justifyContent: 'center' },
  pilotStartText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  pilotErrorRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  pilotWarningText: { color: '#e5a64a', fontSize: 13 },
  pilotWarningTextLight: { color: '#946011' },
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  containerLight: {
    backgroundColor: '#f8fafc',
  },

  /* Cabecera Admin */
  adminHeaderBar: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#102229',
    borderBottomWidth: 1,
    borderBottomColor: '#254047',
    gap: 8,
    zIndex: 100,
  },
  adminHeaderBarLight: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#e2e8f0',
  },
  adminHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminHeaderTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '900',
    color: '#ffffff',
  },
  adminHeaderTitleLight: {
    color: '#0f172a',
  },
  adminFleetBtn: {
    maxWidth: '48%',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d85f28',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  adminFleetBtnText: {
    flexShrink: 1,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  adminHeaderActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  adminActionPillBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  adminActionPillBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  adminActionPillBtnText: {
    flexShrink: 1,
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  adminActionPillBtnTextLight: {
    color: '#0f172a',
  },
  adminCollapseMiniBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },

  /* Barra de Búsqueda Piloto */
  topPlanningBarContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 20,
    left: 16,
    right: 16,
    zIndex: 999,
  },
  topPlanningBarContainerLight: {},
  searchTripBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111c2e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
    gap: 12,
  },
  searchTripBarLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowOpacity: 0.15,
  },
  searchSquareIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchSquareIconLight: {
    backgroundColor: '#f1f5f9',
  },
  pilotTelemetryQuickBtn: {
    backgroundColor: '#111c2e',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#1e293b',
    gap: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  pilotTelemetryQuickBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  pilotTelemetryQuickText: {
    color: '#ff9b6c',
    fontSize: 10,
    fontWeight: '800',
  },
  pilotTelemetryQuickTextLight: {
    color: '#d85f28',
  },
  searchActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchActionIconLight: {
    backgroundColor: '#f1f5f9',
  },
  searchPlaceholderText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '700',
  },
  searchPlaceholderTextLight: {
    color: '#64748b',
  },
  searchTripTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  searchTripTitleLight: {
    color: '#0f172a',
  },
  searchTripSub: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  searchTripSubLight: {
    color: '#94a3b8',
  },

  /* Botones de Ruta */
  routeActionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  saveServerRoutePillBtn: {
    flex: 0.85,
    flexDirection: 'row',
    backgroundColor: 'rgba(216, 95, 40, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(216, 95, 40, 0.42)',
    borderRadius: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveServerRoutePillBtnDisabled: { opacity: 0.45 },
  saveServerRoutePillBtnText: {
    color: '#ff9b6c',
    fontSize: 12,
    fontWeight: '900',
  },
  cancelRoutePillBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelRoutePillBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  startTripPillBtn: {
    flex: 1.5,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  startTripPillBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  cancelTripActiveBtn: {
    width: '100%',
    backgroundColor: '#ef4444',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  cancelTripActiveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },

  /* Guardar ruta del viaje activo */
  serverRouteModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
    backgroundColor: 'rgba(2, 6, 12, 0.76)',
  },
  serverRouteModalCard: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    backgroundColor: '#102229',
    borderWidth: 1,
    borderColor: '#254047',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
    elevation: 18,
  },
  serverRouteModalCardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4e7' },
  serverRouteModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  serverRouteModalIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(216, 95, 40, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(216, 95, 40, 0.32)',
  },
  serverRouteModalEyebrow: { color: '#ff9b6c', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  serverRouteModalEyebrowLight: { color: '#c84f1e' },
  serverRouteModalTitle: { color: '#ffffff', fontSize: 19, fontWeight: '900', marginTop: 2 },
  serverRouteModalTitleLight: { color: '#0f172a' },
  serverRouteModalClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
  },
  serverRoutePathCard: {
    backgroundColor: '#0b1920',
    borderWidth: 1,
    borderColor: '#254047',
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },
  serverRoutePathCardLight: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  serverRoutePathRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  serverRouteOriginDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#d85f28', marginTop: 5 },
  serverRouteDestinationDot: { width: 10, height: 10, borderRadius: 3, backgroundColor: '#ef4444', marginTop: 5 },
  serverRoutePathLine: { width: 2, height: 18, marginLeft: 4, marginVertical: 4, backgroundColor: '#3b555c' },
  serverRoutePathLabel: { color: '#78909a', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  serverRoutePathValue: { color: '#f8fafc', fontSize: 13, fontWeight: '800', marginTop: 2 },
  serverRoutePathValueLight: { color: '#0f172a' },
  serverRouteInputLabel: { color: '#d9e3e7', fontSize: 12, fontWeight: '800', marginBottom: 7 },
  serverRouteInputLabelLight: { color: '#334155' },
  serverRouteInput: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#31515a',
    backgroundColor: '#0b1920',
    color: '#ffffff',
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '700',
  },
  serverRouteInputLight: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', color: '#0f172a' },
  serverRouteErrorText: { color: '#fb7185', fontSize: 11, fontWeight: '700', marginTop: 8 },
  serverRouteModalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  serverRouteCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#193039',
    borderWidth: 1,
    borderColor: '#31515a',
  },
  serverRouteCancelBtnLight: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1' },
  serverRouteCancelBtnText: { color: '#d9e3e7', fontSize: 13, fontWeight: '800' },
  serverRouteCancelBtnTextLight: { color: '#334155' },
  serverRouteSaveBtn: {
    flex: 1.25,
    height: 46,
    flexDirection: 'row',
    gap: 7,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d85f28',
  },
  serverRouteSaveBtnDisabled: { opacity: 0.5 },
  serverRouteSaveBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },

  /* Mapa */
  mapCard: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  mapView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  /* 📍 Punto de Ubicación Limpio para Administrador / SuperAdmin (Estilo Apple/Google Maps) */
  cleanUserLocationWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
  },
  cleanUserLocationHalo: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(59, 130, 246, 0.55)',
  },
  cleanUserLocationDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2563eb',
    borderWidth: 2.5,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 5,
  },

  /* 🍎 Triángulo Oficial de Navegación Apple (Al iniciar viaje) */
  appleNavArrowWrapper: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleNavArrowShadow: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007aff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 8,
  },
  appleNavArrowBorder: {
    position: 'absolute',
  },
  appleNavArrowCore: {
    position: 'absolute',
  },

  /* 📍 Marcador de Salida / Origen Dinámico en Tiempo Real (Pilotos) */
  liveOriginMarkerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveOriginRadarWave: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
    borderWidth: 1.5,
    borderColor: '#3b82f6',
  },
  liveOriginPulseDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2563eb',
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 6,
  },
  liveOriginBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  liveOriginBadgeText: {
    color: '#60a5fa',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  /* Marcador Nativo de Bus */
  nativeBusMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeBusIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
  nativeBusBadge: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  nativeBusBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },

  /* Callout de Bus */
  calloutBox: {
    padding: 8,
    minWidth: 170,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 2,
  },
  calloutSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  calloutRoute: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  calloutSpeed: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  calloutBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2563eb',
    marginTop: 4,
    textAlign: 'center',
  },

  /* Pin Central Flotante */
  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -15,
    marginTop: -38,
    alignItems: 'center',
    zIndex: 999,
  },
  targetPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ef4444',
    borderWidth: 3,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  targetPinInnerSquare: {
    width: 8,
    height: 8,
    backgroundColor: '#ffffff',
    borderRadius: 2,
  },
  pinVerticalStick: {
    width: 3,
    height: 8,
    backgroundColor: '#ffffff',
  },
  pinBlueDotBase: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  /* 🎯 Marcador de Destino Seleccionado */
  destinationMarkerPin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationMarkerPinCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 5,
    elevation: 6,
  },
  destinationMarkerPinTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ef4444',
    marginTop: -1,
  },

  /* ⚡ Velocímetro Flotante Circular en Vivo (Ubicado abajo del botón de desactivar ubicación) */
  floatingSpeedometerContainer: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    zIndex: 990,
  },
  floatingSpeedometerOuter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#0f172a',
    borderWidth: 2.5,
    borderColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  floatingSpeedometerWarning: {
    borderColor: '#f59e0b',
  },
  floatingSpeedometerDanger: {
    borderColor: '#ef4444',
  },
  floatingSpeedometerInner: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111c2e',
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 2,
  },
  speedometerValueText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
    marginTop: 2,
    letterSpacing: -0.5,
  },
  speedometerUnitText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    marginTop: -2,
    letterSpacing: 0.2,
  },

  /* 🛡️ Banner de Privacidad (Compacto y ubicado abajo de la barra de búsqueda) */
  privacyTopAlertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111c2e',
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: '#243248',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  privacyTopAlertCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  privacyTopAlertTitle: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  privacyTopAlertTitleLight: {
    color: '#0f172a',
  },
  privacyTopAlertSub: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 1,
  },
  privacyTopAlertSubLight: {
    color: '#64748b',
  },
  privacyTopAlertBtn: {
    backgroundColor: '#15803d',
    paddingVertical: 4.5,
    paddingHorizontal: 9,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  privacyTopAlertBtnText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '800',
  },

  /* 🛡️ Botón Flotante de Privacidad / Desactivar Ubicación */
  floatingPrivacyShieldBtn: {
    position: 'absolute',
    bottom: 96,
    left: 18,
    width: 62,
    height: 62,
    borderRadius: 31,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 990,
  },
  floatingPrivacyShieldBtnActive: {
    backgroundColor: '#18181b',
    borderWidth: 2,
    borderColor: '#71717a',
  },
  floatingPrivacyShieldBtnWork: {
    backgroundColor: '#18181b',
    borderWidth: 2,
    borderColor: '#22c55e',
  },
  privacyBadgePill: {
    position: 'absolute',
    bottom: -8,
    width: 58,
    paddingVertical: 2,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyBadgePillPrivate: {
    backgroundColor: '#27272a',
    borderColor: '#71717a',
  },
  privacyBadgePillWork: {
    backgroundColor: '#15803d',
    borderColor: '#22c55e',
  },
  privacyBadgePillText: {
    color: '#ffffff',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.2,
    textAlign: 'center',
  },

  /* 🛡️ Modal de Recordatorio de Privacidad */
  reminderModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  reminderModalCard: {
    backgroundColor: '#18181b',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  reminderModalCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e4e4e7',
  },
  reminderIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  reminderTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  reminderTitleLight: {
    color: '#09090b',
  },
  reminderDescription: {
    fontSize: 13,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  reminderDescriptionLight: {
    color: '#52525b',
  },
  reminderButtonsCol: {
    width: '100%',
    gap: 10,
  },
  reminderActivateBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderActivateBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  reminderDismissBtn: {
    backgroundColor: '#27272a',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderDismissBtnLight: {
    backgroundColor: '#f4f4f5',
  },
  reminderDismissBtnText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '700',
  },
  reminderDismissBtnTextLight: {
    color: '#71717a',
  },

  /* Botones Flotantes */
  floatingThemeToggleBtn: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#111c2e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  floatingThemeToggleBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowOpacity: 0.15,
  },
  /* 🚗 Botón Flotante Waze (Ubicado arriba del botón de centrar GPS) */
  floatingWazeBtn: {
    position: 'absolute',
    bottom: 86,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff', // Fondo blanco limpio para resaltar el logo oficial
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#33ccff',
    shadowColor: '#33ccff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.65,
    shadowRadius: 10,
    elevation: 12,
    zIndex: 999,
  },
  floatingWazeImage: {
    width: 32,
    height: 32,
  },
  wazeBadgePill: {
    position: 'absolute',
    bottom: -6,
    backgroundColor: '#0f172a',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  wazeBadgeText: {
    color: '#ffffff',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  floatingGpsCenterBtn: {
    position: 'absolute',
    bottom: 24,
    right: 12,
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#142d35',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#35515a',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  floatingGpsCenterBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#dce5e3',
  },
  gpsCenterTargetOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsCenterTargetInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },

  /* Barra de Confirmación de Pin */
  bottomPinConfirmContainer: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: '#111c2e',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
    gap: 12,
    zIndex: 999,
  },
  bottomPinConfirmContainerLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    shadowOpacity: 0.15,
  },
  pinAddressPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pinIconSmall: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinConfirmTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  pinConfirmTitleLight: {
    color: '#0f172a',
  },
  pinConfirmSubtitle: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  pinConfirmSubtitleLight: {
    color: '#94a3b8',
  },
  pinConfirmButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pinCancelBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pinCancelBtnLight: {
    backgroundColor: '#f1f5f9',
  },
  pinCancelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '800',
  },
  pinCancelBtnTextLight: {
    color: '#475569',
  },
  pinConfirmBtn: {
    flex: 1.8,
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pinConfirmBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  /* 📌 Banner Superior en Vivo de Texto Ingresado (Para Piloto) */
  pilotLiveInputBanner: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  pilotLiveInputBadge: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pilotLiveInputBadgeText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '900',
  },
  pilotLiveInputText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },

  /* Modales */
  planModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  planModalCard: {
    backgroundColor: '#0b1324',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  planModalCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  modalDragIndicatorWrapper: {
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 6,
  },
  modalDragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
  },
  modalDragIndicatorLight: {
    backgroundColor: '#cbd5e1',
  },
  pilotLiveInputDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#147d62',
    marginRight: 4,
  },
  planModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  planModalHeaderIconSquare: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planModalTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
  },
  planModalTitleLight: {
    color: '#0f172a',
  },
  closeModalCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeModalText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  routeInputsBox: {
    backgroundColor: '#111c2e',
    borderRadius: 18,
    padding: 14,
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  },
  routeInputsBoxLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  inputWithDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  originBlueDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3b82f6',
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  destPurpleSquare: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: '#d85f28',
  },
  destRedSquare: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: '#d85f28',
  },
  clearSearchInputBtn: {
    padding: 6,
  },
  originTextInput: {
    flex: 1,
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '700',
  },
  originTextInputLight: {
    color: '#52525b',
  },
  destTextInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  destTextInputLight: {
    color: '#09090b',
  },
  verticalInputConnector: {
    width: 2,
    height: 14,
    backgroundColor: '#3f3f46',
    marginLeft: 5,
  },
  fixOnMapQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111c2e',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  },
  fixOnMapQuickBtnLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  fixOnMapIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixOnMapQuickText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  fixOnMapQuickTextLight: {
    color: '#0f172a',
  },
  placesScrollView: {
    marginTop: 12,
    maxHeight: 340,
  },
  searchingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  searchingText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
  },
  suggestionItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    gap: 12,
  },
  suggestionItemRouteHighlight: {
    backgroundColor: '#111c2e',
    borderBottomColor: '#243248',
  },
  suggestionItemRowLight: {
    borderBottomColor: '#f1f5f9',
  },
  placeIconSquare: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#111c2e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  placeIconSquareRoute: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  placeIconSquareLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  suggestionName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  suggestionNameLight: {
    color: '#09090b',
  },
  suggestionAddress: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  suggestionAddressLight: {
    color: '#71717a',
  },
  placeDistanceBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  placeDistanceBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },

  /* Rutas Más Usadas de la Semana */
  topRoutesSection: {
    marginBottom: 16,
  },
  topRoutesSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  topRoutesSectionTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  topRoutesBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  topRoutesBadgeText: {
    color: '#ff9b6c',
    fontSize: 10,
    fontWeight: '800',
  },
  topRoutesList: {
    gap: 8,
  },
  topRouteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111c2e',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  },
  topRouteCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  topRouteIconSquare: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  topRouteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  topRouteCardName: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '800',
    flex: 1,
  },
  topRouteCardNameLight: {
    color: '#0f172a',
  },
  topRouteCodeBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  topRouteCodeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  topRouteCardSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  topRouteCardSubLight: {
    color: '#64748b',
  },
  topRouteMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  metricPillHighlight: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  topRouteMetricItem: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '700',
  },
  topRouteMetricHighlight: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '800',
  },
  topRouteSelectArrow: {
    color: '#d85f28',
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 4,
  },

  /* Historial */
  historySection: {
    marginTop: 8,
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sectionTitleLight: {
    color: '#64748b',
  },
  emptyHistoryText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 10,
  },

  /* Modal Cancelar Viaje */
  cancelTripModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  cancelTripModalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cancelTripIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cancelTripModalTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  cancelTripModalDescription: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  cancelTripModalButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelTripModalKeepBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelTripModalKeepBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  cancelTripModalConfirmBtn: {
    flex: 1,
    backgroundColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelTripModalConfirmBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  /* 🏁 Modal Llegada a Destino */
  arrivalModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  arrivalModalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    borderWidth: 1.5,
    borderColor: '#147d62',
    shadowColor: '#147d62',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  arrivalModalCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#147d62',
  },
  arrivalIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  arrivalModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  arrivalModalTitleLight: {
    color: '#0f172a',
  },
  arrivalModalQuestion: {
    fontSize: 14,
    fontWeight: '800',
    color: '#147d62',
    textAlign: 'center',
    marginBottom: 14,
  },
  arrivalModalQuestionLight: {
    color: '#059669',
  },
  arrivalDestinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111c2e',
    borderRadius: 14,
    padding: 10,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 10,
    marginBottom: 12,
  },
  arrivalDestinationCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  arrivalPinSquare: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrivalDestinationName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  arrivalDestinationNameLight: {
    color: '#0f172a',
  },
  arrivalDestinationAddress: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  arrivalDestinationAddressLight: {
    color: '#64748b',
  },
  arrivalModalHint: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 15,
  },
  arrivalModalHintLight: {
    color: '#94a3b8',
  },
  arrivalModalButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  arrivalCancelBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  arrivalCancelBtnLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  arrivalCancelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '800',
  },
  arrivalCancelBtnTextLight: {
    color: '#475569',
  },
  arrivalFinishBtn: {
    flex: 1.3,
    backgroundColor: '#147d62',
    borderRadius: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#147d62',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 5,
  },
  arrivalFinishBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  /* Modal Flota */
  fleetModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(3,10,14,0.68)',
    justifyContent: 'flex-end',
  },
  fleetModalDismissArea: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  fleetModalKeyboardArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  fleetModalCard: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 9,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1e293b',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 18,
  },
  fleetModalCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4e8',
    shadowColor: '#172429',
    shadowOpacity: 0.12,
  },
  fleetModalHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    marginBottom: 12,
  },
  fleetModalHandleLight: {
    backgroundColor: '#d7e0e3',
  },
  fleetModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  fleetModalHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(216,95,40,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(216,95,40,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetModalHeaderIconLight: {
    backgroundColor: '#fff0e8',
    borderColor: '#ffd6c1',
  },
  fleetModalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  fleetModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.25,
  },
  fleetModalTitleLight: {
    color: '#0f172a',
  },
  fleetModalSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  fleetModalSubtitleLight: {
    color: '#64748b',
  },
  fleetModalCountBadge: {
    minWidth: 30,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(216,95,40,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetModalCountBadgeLight: {
    backgroundColor: '#fff0e8',
  },
  fleetModalCountText: {
    color: '#d85f28',
    fontSize: 13,
    fontWeight: '900',
  },
  fleetModalCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetModalCloseButtonLight: {
    backgroundColor: '#eef2f4',
  },
  fleetSearchBox: {
    minHeight: 48,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 12,
  },
  fleetSearchBoxLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#dbe4e8',
  },
  fleetSearchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  fleetSearchInputLight: {
    color: '#0f172a',
  },
  fleetSearchClearButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetModalList: { flexGrow: 0, flexShrink: 1 },
  fleetModalListContent: { paddingBottom: 4 },
  fleetEmptyState: {
    minHeight: 178,
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#26364a',
    backgroundColor: '#111c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetEmptyStateLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  fleetSearchEmptyState: {
    minHeight: 150,
  },
  fleetEmptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(216,95,40,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  fleetEmptyIconLight: {
    backgroundColor: '#fff0e8',
  },
  fleetEmptyTitle: { color: '#ffffff', fontWeight: '900', fontSize: 16, marginBottom: 5, textAlign: 'center' },
  fleetEmptyTitleLight: { color: '#0f172a' },
  fleetEmptyMessage: { maxWidth: 310, color: '#94a3b8', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  fleetEmptyMessageLight: { color: '#64748b' },
  fleetBusItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginBottom: 9,
    gap: 10,
  },
  fleetBusItemCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  fleetBusItemIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(216,95,40,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetBusItemIconLight: {
    backgroundColor: '#fff0e8',
  },
  fleetBusItemCopy: {
    flex: 1,
    minWidth: 0,
  },
  fleetBusItemPlate: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  fleetBusItemPlateLight: {
    color: '#0f172a',
  },
  fleetBusItemPilot: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  fleetBusItemPilotLight: {
    color: '#475569',
  },
  fleetBusItemRoute: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  fleetBusItemRouteLight: {
    color: '#64748b',
  },
  fleetBusItemAside: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  fleetBusItemSpeedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  fleetBusItemSpeedText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  fleetModalHint: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  fleetModalHintLight: {
    color: '#7b8b91',
  },

  /* ⭐ Estilos para Ubicaciones Guardadas / Favoritos y Preview de Viajes Recientes (7 días) */
  savedLocationsCardContainer: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    gap: 8,
  },
  savedLocationsCardContainerLight: {
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
  },
  savedLocationsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savedLocationsBadgeText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
  },
  recentTripsPreviewList: {
    marginTop: 4,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 8,
  },
  recentTripItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  recentTripItemRowLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e4e4e7',
  },
  recentTripNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTripNumberText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '900',
  },
  recentTripNameText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  recentTripNameTextLight: {
    color: '#09090b',
  },
  recentTripTimeText: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  recentTripTimeTextLight: {
    color: '#64748b',
  },
  quickStartTripMiniBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickStartTripMiniBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  savedLocationsQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#18181b',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  savedLocationsQuickBtnLight: {
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
  },
  savedIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedIconCircleLight: {
    backgroundColor: '#fef08a',
  },
  savedLocationsQuickTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  savedLocationsQuickTitleLight: {
    color: '#09090b',
  },
  savedLocationsQuickSub: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 1,
  },
  savedLocationsQuickSubLight: {
    color: '#a1a1aa',
  },
  savedArrowText: {
    color: '#eab308',
    fontSize: 15,
    fontWeight: '900',
  },
  addNewSavedPlaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: '#2563eb',
    gap: 12,
  },
  addNewSavedPlaceBtnLight: {
    backgroundColor: '#eff6ff',
    borderColor: '#3b82f6',
  },
  addNewPlacePlusCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addNewPlaceTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  addNewPlaceSub: {
    color: '#93c5fd',
    fontSize: 11,
    marginTop: 1,
  },
  addNewPlaceArrow: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: '900',
  },
  emptySavedPlacesBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  emptySavedPlacesText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySavedPlacesTextLight: {
    color: '#09090b',
  },
  emptySavedPlacesSub: {
    color: '#71717a',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  savedPlaceCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#18181b',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    gap: 10,
  },
  savedPlaceCardItemLight: {
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
  },
  savedPlaceIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedPlaceIconBoxLight: {
    backgroundColor: '#e4e4e7',
  },
  savedPlaceNameText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  savedPlaceNameTextLight: {
    color: '#09090b',
  },
  savedPlaceAddressText: {
    color: '#a1a1aa',
    fontSize: 11,
    marginTop: 2,
  },
  savedPlaceAddressTextLight: {
    color: '#52525b',
  },
  savedPlaceDistText: {
    color: '#eab308',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  deleteSavedPlaceBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  savedLocationNameInput: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eab308',
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  savedLocationNameInputLight: {
    backgroundColor: '#f4f4f5',
    borderColor: '#ca8a04',
    color: '#09090b',
  },

  /* --- Barra Superior Segmentada Exacta: Mapa GPS vs Feed de Unidades --- */
  topSegmentedBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
    zIndex: 999,
  },
  collapseArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#102229',
    borderWidth: 1,
    borderColor: '#254047',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapseArrowBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  collapseArrowBtnCollapsed: {
    backgroundColor: '#d85f28',
    borderColor: '#f07840',
  },
  adminCollapseMiniBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#102229',
    borderWidth: 1,
    borderColor: '#254047',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingPanelReopenTab: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#102229',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.45)',
    marginVertical: 4,
    zIndex: 10,
  },
  floatingPanelReopenText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  topSegmentedBar: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#102229',
    padding: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#254047',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
    gap: 4,
  },
  topSegmentedBarLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 11,
    gap: 6,
  },
  segmentBtnActive: {
    backgroundColor: '#d85f28',
    shadowColor: '#d85f28',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  segmentBtnTextLight: {
    color: '#64748b',
  },
  segmentBtnTextActive: {
    color: '#ffffff',
    fontWeight: '900',
  },

  /* --- Tarjeta Flotante Quick Card Exacta al Diseño de la Web App Eunice --- */
  adminHeaderCoordsText: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 2,
  },
  floatingSaaSQuickCard: {
    position: 'absolute',
    bottom: 16,
    left: 10,
    right: 10,
    backgroundColor: '#102229',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#254047',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 16,
    zIndex: 998,
  },
  quickCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  quickCardAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#d85f28',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCardAvatarInitial: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  quickCardMetaCol: {
    flex: 1,
  },
  quickCardNameText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  quickCardPilotRoleBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d85f28',
  },
  quickCardPilotRoleText: {
    color: '#f0c6b1',
    fontSize: 8.5,
    fontWeight: '800',
  },
  quickCardRouteText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  quickCardSpeedText: {
    color: '#49b997',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1,
  },
  quickCardCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#254047',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#254047',
  },
  quickCardStatusPillLive: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  quickCardStatusTextLive: {
    color: '#49b997',
    fontSize: 10,
    fontWeight: '900',
  },
  quickCardTraceRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d85f28',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    shadowColor: '#d85f28',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  quickCardTraceRouteText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },

  /* --- Panel de Navegación Activa y Asistente de Carriles --- */
  activeNavigationCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    gap: 8,
  },
  activeNavigationCardLight: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(16, 185, 129, 0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
  },
  navInstructionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navManeuverIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navDistanceCountdown: {
    fontSize: 18,
    fontWeight: '900',
    color: '#147d62',
    letterSpacing: -0.3,
  },
  navDistanceCountdownLight: {
    color: '#059669',
  },
  navInstructionMain: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
    marginTop: 1,
  },
  navInstructionMainLight: {
    color: '#0f172a',
  },
  laneAssistantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(2, 6, 23, 0.6)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  laneAssistantRowLight: {
    backgroundColor: '#f1f5f9',
  },
  laneIconsCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  laneArrowPill: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  laneArrowPillActive: {
    backgroundColor: '#147d62',
  },
  laneLabelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  laneLabelBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#49b997',
  },
  navFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  navFooterSub: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    flex: 1,
  },
  navFooterSubLight: {
    color: '#64748b',
  },
  cancelTripCompactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  cancelTripCompactBtnText: {
    color: '#ef4444',
    fontSize: 11.5,
    fontWeight: '700',
  },
});
