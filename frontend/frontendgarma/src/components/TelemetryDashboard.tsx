import React, { useState, useEffect, useRef, useCallback } from 'react';
import { isAxiosError } from 'axios';
import { useAuth } from '../context/useAuth';
import api, { buildWebSocketUrl } from '../services/api';
import { GoogleMapWeb } from './GoogleMapWeb';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Dialog, Field } from './Dialog';
import type { ConfirmationState } from './ConfirmationDialog';
import { AnimatedSelect } from './AnimatedSelect';
import { ToastViewport } from './ToastViewport';
import type { ToastNotification, ToastTone } from './ToastViewport';
import { DashboardHeader } from './DashboardHeader';
import { DashboardSidebar } from './DashboardSidebar';
import { PilotTrackingBar } from './PilotTrackingBar';
import { PassengerInbox } from './PassengerInbox';
import { BusQrModal } from './BusQrModal';
import { RouteStopsModal } from './RouteStopsModal';
import { usePilotTelemetry, type PilotNavigationState } from '../hooks/usePilotTelemetry';
import { getDashboardStyles } from '../styles/dashboardStyles';
import { hasValidCoordinates } from '../utils/mapSupport';
import QRCode from 'qrcode';
import type { Alerta, Autobus, ChatMessage, DashboardTab, LiveTelemetryData, ManagedUser, Ruta, Viaje } from '../types/dashboard';
import { 
  Navigation, 
  Bus, 
  Users, 
  MessageSquare, 
  MessageCircle,
  Search, 
  Radio, 
  AlertTriangle, 
  CheckCircle2,
  Send,
  Trash2,
  Plus,
  Pencil,
  UserRoundCheck,
  UserRoundX,
  Save,
  RefreshCw,
  FileDown,
  Sheet,
  ChevronDown,
  Gauge,
  Wifi,
  BarChart3,
  Copy,
  ExternalLink,
  QrCode,
  MapPinned,
  MapPin,
  ArrowRight,
  BookmarkPlus
} from 'lucide-react';

interface PublicTripAccess {
  activo: boolean;
  token?: string;
  fechaExpiracion?: string;
  chatHabilitado: boolean;
}

interface ApiErrorPayload {
  mensaje?: string;
  title?: string;
  errors?: Record<string, string[]>;
}

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (isAxiosError<ApiErrorPayload>(error)) {
    const payload = error.response?.data;
    if (payload?.mensaje) return payload.mensaje;
    const validationMessage = payload?.errors
      ? Object.values(payload.errors).flat().find(Boolean)
      : undefined;
    return validationMessage ?? payload?.title ?? fallback;
  }
  return fallback;
};

const finiteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeLiveTelemetry = (item: LiveTelemetryData, receivedAt: number): LiveTelemetryData => {
  const latitud = finiteNumber(item.latitud);
  const longitud = finiteNumber(item.longitud);
  const isPrivacyMode = Boolean(item.isPrivacyMode);
  return {
    ...item,
    latitud,
    longitud,
    velocidadKmh: Math.max(0, finiteNumber(item.velocidadKmh)),
    destinoLat: item.destinoLat == null ? null : finiteNumber(item.destinoLat),
    destinoLng: item.destinoLng == null ? null : finiteNumber(item.destinoLng),
    destinoNombre: item.destinoNombre || null,
    isTripActive: Boolean(item.isTripActive),
    isPrivacyMode,
    locationStatus: isPrivacyMode ? 'privacy' : hasValidCoordinates(latitud, longitud) ? 'tracking' : 'unavailable',
    lastUpdated: receivedAt,
    lastObservedAt: Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(item.fechaHoraDispositivo) ? item.fechaHoraDispositivo : `${item.fechaHoraDispositivo}Z`) || 0,
  };
};

const createLiveSnapshot = (items: LiveTelemetryData[], receivedAt: number): Record<string, LiveTelemetryData> => {
  const snapshot: Record<string, LiveTelemetryData> = {};
  items.forEach((item) => {
    if (!item?.placaAutobus || item.isOffline) return;
    if (item.placaAutobus.toUpperCase() === 'PRUEBA' || item.nombrePiloto?.toLowerCase().includes('administrador')) return;
    snapshot[item.placaAutobus] = normalizeLiveTelemetry(item, receivedAt);
  });
  return snapshot;
};

const mergeLiveSnapshot = (
  current: Record<string, LiveTelemetryData>,
  items: LiveTelemetryData[],
  requestStartedAt: number,
  receivedAt: number,
) => {
  const snapshot = createLiveSnapshot(items, receivedAt);
  Object.entries(current).forEach(([plate, bus]) => {
    if (!bus.isOffline && (bus.lastUpdated ?? 0) > requestStartedAt) {
      snapshot[plate] = bus;
    }
  });
  return snapshot;
};

// `now` es el reloj de frescura del panel, que avanza cada pocos segundos. Una lectura más nueva que ese
// reloj es normal (llegó entre dos avances), así que el límite de "fecha futura" usa la hora real.
const isTelemetryFresh = (bus: LiveTelemetryData, now: number) => {
  if (bus.isOffline || !bus.lastObservedAt) return false;
  const wallClock = Math.max(now, Date.now());
  return now - bus.lastObservedAt < 30000 && bus.lastObservedAt <= wallClock + 5000;
};

// Mismos umbrales que los marcadores del mapa: más de 80 km/h es alerta y más de 50 es precaución.
const speedChipColors = (speed: number | undefined) => {
  const kmh = speed || 0;
  if (kmh > 80) return { backgroundColor: 'var(--danger-soft)', color: 'var(--danger-ink)', border: '1px solid transparent' };
  if (kmh > 50) return { backgroundColor: 'var(--warning-soft)', color: 'var(--warning-ink)', border: '1px solid transparent' };
  return { backgroundColor: 'var(--success-soft)', color: 'var(--success)', border: '1px solid transparent' };
};

// Tonos de la paleta Ruta cálida que se leen bien en modo claro y oscuro.
const CHAT_SENDER_PALETTE = [
  { accent: '#2F8A66', light: '#e3f0e9', dark: 'rgba(47, 138, 102, 0.18)' },
  { accent: '#A8740F', light: '#f7ecd4', dark: 'rgba(168, 116, 15, 0.2)' },
  { accent: '#B9493A', light: '#f6e2de', dark: 'rgba(185, 73, 58, 0.18)' },
  { accent: '#3F7AA3', light: '#e2edf4', dark: 'rgba(63, 122, 163, 0.2)' },
  { accent: '#7D62A8', light: '#ece6f4', dark: 'rgba(125, 98, 168, 0.2)' },
  { accent: '#2A8A8A', light: '#ddefee', dark: 'rgba(42, 138, 138, 0.2)' },
];

const getChatSenderVisual = (id: number, name: string) => {
  const source = `${id}:${name}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return CHAT_SENDER_PALETTE[Math.abs(hash) % CHAT_SENDER_PALETTE.length];
};

const getChatInitials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return `${words[0][0] ?? ''}${words.length > 1 ? words[words.length - 1][0] ?? '' : ''}`.toUpperCase();
};

export const TelemetryDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const canManageOperations = user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador';
  const canMonitorOperations = canManageOperations || user?.tipoRol === 'Supervisor';

  // Estado y sincronización de Tema Oscuro / Claro
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('garma_theme');
    return (saved === 'dark' || saved === 'light') ? saved : 'light';
  });
  const isDark = theme === 'dark';
  const [freshnessTimestamp, setFreshnessTimestamp] = useState(() => Date.now());
  const [lastTelemetrySyncAt, setLastTelemetrySyncAt] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  const toastIdRef = useRef(0);
  const historicalRequestIdRef = useRef(0);

  const dismissNotification = useCallback((id: number) => {
    setNotifications((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++toastIdRef.current;
    setNotifications((current) => [...current.slice(-3), { id, message, tone }]);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('garma_theme', nextTheme);
  };

  useEffect(() => {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => setFreshnessTimestamp(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Generación de estilos dinámicos para modo claro/oscuro
  const {
    containerStyle,
    mainContentWrapperStyle,
    cardTitleStyle,
    usersContainerStyle,
    tableHeaderStyle,
    addButtonStyle,
    loadingTableStyle,
    tableWrapperStyle,
    tableStyle,
    thStyle,
    trStyle,
    tdStyle,
    activateButtonStyle,
    statusBadgeStyle,
    errorBannerStyle,
    formInputStyle,
    saveButtonStyle
  } = getDashboardStyles(isDark);

  // Estados de Flota en Vivo y Rutas
  const [liveBuses, setLiveBuses] = useState<Record<string, LiveTelemetryData>>({});
  const [activeLiveRoutePlaca, setActiveLiveRoutePlaca] = useState<string | null>(null);

  const handleToggleLiveRoute = (placa: string) => {
    setActiveLiveRoutePlaca((prev) => (prev === placa ? null : placa));
  };

  // Desduplicar por placa: dos unidades distintas no deben desaparecer por compartir nombre de piloto.
  const getDeduplicatedLiveBuses = (busesRecord: Record<string, LiveTelemetryData>) => {
    const rawList = Object.values(busesRecord);
    const plateMap = new Map<string, LiveTelemetryData>();

    rawList.forEach((b) => {
      if (
        b.placaAutobus?.toUpperCase() === 'PRUEBA' ||
        b.nombrePiloto?.toLowerCase().includes('administrador')
      ) {
        return;
      }
      const plateKey = b.placaAutobus.trim().toUpperCase();
      const existing = plateMap.get(plateKey);
      if (!existing) {
        plateMap.set(plateKey, b);
      } else {
        const existingHasCoords = hasValidCoordinates(existing.latitud, existing.longitud);
        const bHasCoords = hasValidCoordinates(b.latitud, b.longitud);
        if (!existingHasCoords && bHasCoords) {
          plateMap.set(plateKey, b);
        } else if ((b.lastUpdated || 0) > (existing.lastUpdated || 0)) {
          plateMap.set(plateKey, b);
        }
      }
    });

    return Array.from(plateMap.values());
  };

  // Une telemetría y catálogo: la pestaña "Flota" también debe mostrar unidades
  // registradas que todavía no hayan enviado una ubicación.
  const getTrackingFleet = () => {
    const fleetMap = new Map<string, LiveTelemetryData>();

    getDeduplicatedLiveBuses(liveBuses).forEach((liveBus) => {
      fleetMap.set(liveBus.placaAutobus.trim().toUpperCase(), liveBus);
    });

    buses.forEach((registeredBus) => {
      const plateKey = registeredBus.placa.trim().toUpperCase();
      if (!plateKey || plateKey === 'PRUEBA') return;

      const existingLiveBus = fleetMap.get(plateKey);
      if (existingLiveBus) {
        fleetMap.set(plateKey, {
          ...existingLiveBus,
          marcaModelo: registeredBus.marcaModelo,
          registeredStatus: registeredBus.estado,
        });
        return;
      }

      const assignedTrip = trips.find((trip) => (
        trip.estadoViaje === 'En Curso' && (
          trip.idAutobus === registeredBus.idAutobus ||
          trip.placaAutobus?.trim().toUpperCase() === plateKey
        )
      ));

      fleetMap.set(plateKey, {
        placaAutobus: registeredBus.placa,
        nombrePiloto: assignedTrip?.nombrePiloto || 'Sin piloto en turno',
        nombreRuta: assignedTrip?.nombreRuta || 'Sin ruta asignada',
        velocidadKmh: 0,
        latitud: 0,
        longitud: 0,
        fechaHoraDispositivo: '',
        locationStatus: 'unavailable',
        isOffline: true,
        marcaModelo: registeredBus.marcaModelo,
        registeredStatus: registeredBus.estado,
      });
    });

    return Array.from(fleetMap.values());
  };

  // Estados para Vista SaaS Tracking Split-Screen
  const [trackingSearchQuery, setTrackingSearchQuery] = useState<string>('');
  const [directoryQuery, setDirectoryQuery] = useState<string>('');
  const [directoryFilter, setDirectoryFilter] = useState<string>('all');
  const [trackingTabFilter, setTrackingTabFilter] = useState<'active' | 'all'>('active');
  const [focusedBusPlaca, setFocusedBusPlaca] = useState<string | null>(null);

  // Estados para Navegación del Panel
  const [activeTab, setActiveTab] = useState<DashboardTab>('map');
  // Cada pantalla de directorio tiene sus propios filtros: al cambiar de pantalla se empieza limpio.
  const [directoryTab, setDirectoryTab] = useState(activeTab);
  if (directoryTab !== activeTab) {
    setDirectoryTab(activeTab);
    setDirectoryQuery('');
    setDirectoryFilter('all');
  }

  // Estados para el Módulo de Chat en Tiempo Real (General & Privado)
  const [chatMode, setChatMode] = useState<'general' | 'private'>('general');
  const [showPassengerInbox, setShowPassengerInbox] = useState(false);
  const [qrBus, setQrBus] = useState<Autobus | null>(null);
  const [stopsRoute, setStopsRoute] = useState<Ruta | null>(null);
  const [selectedChatPilotId, setSelectedChatPilotId] = useState<number>(0);
  const [selectedChatPilotName, setSelectedChatPilotName] = useState<string>('Piloto');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatDraftKey = chatMode === 'general' ? 'general' : `pilot:${user?.tipoRol === 'Piloto' ? user.idUsuario : selectedChatPilotId}`;
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const chatInput = chatDrafts[chatDraftKey] ?? '';
  const setChatInput = (value: string) => setChatDrafts(previous => ({ ...previous, [chatDraftKey]: value }));
  const chatSendIds = useRef(new Map<string, { content: string; id: string }>());
  const [chatSending, setChatSending] = useState<boolean>(false);
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [expandedMessageTimestamps, setExpandedMessageTimestamps] = useState<Record<string, boolean>>({});
  const chatModeRef = useRef(chatMode);
  const selectedChatPilotIdRef = useRef(selectedChatPilotId);

  useEffect(() => {
    chatModeRef.current = chatMode;
    selectedChatPilotIdRef.current = selectedChatPilotId;
  }, [chatMode, selectedChatPilotId]);

  const [chatContextMenu, setChatContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    idMensaje: string;
  } | null>(null);

  const handleMessageContextMenu = (e: React.MouseEvent, msg: ChatMessage) => {
    if (user?.tipoRol !== 'Administrador' && user?.tipoRol !== 'SuperAdministrador') return;
    e.preventDefault();
    e.stopPropagation();
    setChatContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      idMensaje: msg.idMensaje,
    });
  };

  useEffect(() => {
    const handleGlobalClose = () => {
      if (chatContextMenu) setChatContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClose);
    return () => window.removeEventListener('click', handleGlobalClose);
  }, [chatContextMenu]);

  // Modal de Confirmación Personalizado con la estética de la Web App
  const [customConfirm, setCustomConfirm] = useState<ConfirmationState>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    isDanger: true,
    onConfirm: () => {},
  });

  const requestConfirmation = (params: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }) => {
    setCustomConfirm({
      isOpen: true,
      title: params.title,
      message: params.message,
      confirmText: params.confirmText || 'Confirmar',
      cancelText: params.cancelText || 'Cancelar',
      isDanger: params.isDanger !== undefined ? params.isDanger : true,
      onConfirm: params.onConfirm,
    });
  };

  const closeCustomConfirm = () => {
    setCustomConfirm((prev) => ({ ...prev, isOpen: false }));
  };

  const handleLogout = () => {
    requestConfirmation({
      title: 'Cerrar Sesión',
      message: '¿Estás seguro de que deseas cerrar sesión en el sistema? Tendrás que ingresar tus credenciales nuevamente para acceder.',
      confirmText: 'Cerrar Sesión',
      cancelText: 'Cancelar',
      isDanger: true,
      onConfirm: async () => {
        try {
          await logout();
        } catch (error) {
          notify(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.', 'error');
        }
      }
    });
  };

  const toggleMessageTimestamp = (idMensaje: string) => {
    setExpandedMessageTimestamps((prev) => ({
      ...prev,
      [idMensaje]: !prev[idMensaje]
    }));
  };

  const handleDeleteChatMessage = (idMensaje: string) => {
    requestConfirmation({
      title: 'Eliminar Mensaje',
      message: '¿Estás seguro de que deseas eliminar permanentemente este mensaje? Esta acción no se puede deshacer y se sincronizará con toda la flota.',
      confirmText: 'Eliminar Mensaje',
      cancelText: 'Cancelar',
      isDanger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/chat/${idMensaje}`);
          setChatMessages((prev) => prev.filter((m) => m.idMensaje !== idMensaje));
        } catch (err) {
          console.warn('Error al eliminar mensaje de chat:', err);
        }
      }
    });
  };

  const handleClearChatChannel = () => {
    const channelId = getActiveChatChannelId();
    const chanName = chatMode === 'general' ? 'el Canal General de Operaciones' : `la conversación privada con ${selectedChatPilotName}`;
    requestConfirmation({
      title: 'Vaciar Conversación Completa',
      message: `¿Estás totalmente seguro de que deseas vaciar TODOS los mensajes de ${chanName}? Se eliminará el historial de forma permanente.`,
      confirmText: 'Vaciar Todo',
      cancelText: 'Cancelar',
      isDanger: true,
      onConfirm: async () => {
        try {
          await api.delete(`/chat/canal/${channelId}`);
          setChatMessages([]);
        } catch (err) {
          console.warn('Error al vaciar canal:', err);
        }
      }
    });
  };

  // Referencias para el control de scroll y posición de lectura del Chat
  const chatMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  const channelScrollPositionsRef = useRef<Record<string, number>>({});
  const chatRequestIdRef = useRef(0);

  const scrollToChatBottom = (behavior: ScrollBehavior = 'auto') => {
    if (chatMessagesContainerRef.current) {
      chatMessagesContainerRef.current.scrollTo({
        top: chatMessagesContainerRef.current.scrollHeight,
        behavior
      });
    }
  };

  const handleChatScroll = () => {
    if (chatMessagesContainerRef.current) {
      const channelKey = chatMode === 'general' ? 'general' : `pilot_${selectedChatPilotId}`;
      channelScrollPositionsRef.current[channelKey] = chatMessagesContainerRef.current.scrollTop;
    }
  };

  // Estados para el Módulo de Actividad / Historial de Viajes (Estilo Uber)
  const [selectedTripDetail, setSelectedTripDetail] = useState<Viaje | null>(null);
  const [showTripDetailModal, setShowTripDetailModal] = useState<boolean>(false);
  const [activitySearchQuery, setActivitySearchQuery] = useState<string>('');
  const [activityFilterPilot, setActivityFilterPilot] = useState<string>('');
  const [activityFilterStatus, setActivityFilterStatus] = useState<string>('');
  const [activityFilterDate, setActivityFilterDate] = useState<string>('');
  const [activityTimeRange, setActivityTimeRange] = useState<'week' | 'all'>('week');
  const [publicTripLink, setPublicTripLink] = useState<string | null>(null);
  const [publicTripQr, setPublicTripQr] = useState<string | null>(null);
  const [creatingPublicLink, setCreatingPublicLink] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPublicTripLink(null);
      setPublicTripQr(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedTripDetail?.idViaje]);

  // Estados para CRUD de Usuarios
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const removedUserIdsRef = useRef(new Set<number>());
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [crudError, setCrudError] = useState<string | null>(null);
  
  // Estado para Formulario/Modal de Usuario
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null); // null = Crear, número = Editar
  const userEditingVersion = useRef<string | undefined>(undefined);
  const [formNombre, setFormNombre] = useState('');
  const [formLogin, setFormLogin] = useState('');
  const [formRol, setFormRol] = useState<'Piloto' | 'Administrador' | 'Supervisor' | 'SuperAdministrador'>('Piloto');
  const [formContrasena, setFormContrasena] = useState('');
  const [formEstado, setFormEstado] = useState<'Activo' | 'Inactivo'>('Activo');

  // Estados para CRUD de Autobuses
  const [buses, setBuses] = useState<Autobus[]>([]);
  const [loadingBuses, setLoadingBuses] = useState<boolean>(false);
  const [showBusModal, setShowBusModal] = useState<boolean>(false);
  const [editingBusId, setEditingBusId] = useState<number | null>(null);
  const [formPlaca, setFormPlaca] = useState('');
  const [formMarcaModelo, setFormMarcaModelo] = useState('');
  const [formEstadoBus, setFormEstadoBus] = useState<'Activo' | 'Inactivo' | 'En Taller'>('Activo');
  const [formPilotoAsignado, setFormPilotoAsignado] = useState<number>(0);
  const [formRutaAsignadaBus, setFormRutaAsignadaBus] = useState<number>(0);
  const [manageBusAssignment, setManageBusAssignment] = useState(false);
  const busEditingSnapshot = useRef<Autobus | null>(null);
  const [busSaving, setBusSaving] = useState(false);
  const busSaveInFlightRef = useRef(false);
  const dispatchOperation = useRef<{ signature: string; id: string } | null>(null);
  const dispatchBusy = useRef(false);

  // Catálogo de Rutas para Despacho
  const [routes, setRoutes] = useState<Ruta[]>([]);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [routeSaving, setRouteSaving] = useState(false);
  const [formRouteName, setFormRouteName] = useState('');
  const [formRouteOrigin, setFormRouteOrigin] = useState('');
  const [formRouteDestination, setFormRouteDestination] = useState('');
  const [routeTripContext, setRouteTripContext] = useState<{ idViaje: number; destinoLatitud: number; destinoLongitud: number } | null>(null);

  // Estados para CRUD de Viajes Diarios
  const [trips, setTrips] = useState<Viaje[]>([]);
  const [loadingTrips, setLoadingTrips] = useState<boolean>(false);
  const [showTripModal, setShowTripModal] = useState<boolean>(false);
  const [formTripPiloto, setFormTripPiloto] = useState<number>(0);
  const [formTripBus, setFormTripBus] = useState<number>(0);
  const [formTripRoute, setFormTripRoute] = useState<number>(0);

  const [activeTrip, setActiveTrip] = useState<Viaje | null>(null);
  const [loadingActiveTrip, setLoadingActiveTrip] = useState<boolean>(false);
  const [pilotNavigation, setPilotNavigation] = useState<PilotNavigationState | null>(null);
  const activeTripRef = useRef<Viaje | null>(null);
  const activeTripFetchFailedRef = useRef(false);

  const fetchActiveTripForPilot = useCallback(async () => {
    try {
      if (!activeTripRef.current) setLoadingActiveTrip(true);
      const response = await api.get<Viaje>('/viajes/activo-piloto', {
        params: { permitirVacio: true },
      });
      activeTripFetchFailedRef.current = false;
      if (response.status === 204 || !response.data) {
        activeTripRef.current = null;
        setActiveTrip(null);
        setPilotNavigation(null);
        return;
      }
      activeTripRef.current = response.data;
      setActiveTrip((current) => JSON.stringify(current) === JSON.stringify(response.data) ? current : response.data);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        activeTripRef.current = null;
        setActiveTrip(null);
        setPilotNavigation(null);
      } else if (navigator.onLine && !activeTripFetchFailedRef.current) {
        activeTripFetchFailedRef.current = true;
        notify('No se pudo verificar el despacho. Se conservará el rastreo actual y se reintentará.', 'warning');
      }
    } finally {
      setLoadingActiveTrip(false);
    }
  }, [notify]);

  const liveSocketRef = useRef<WebSocket | null>(null);
  const pilotTracking = usePilotTelemetry({
    enabled: user?.tipoRol === 'Piloto',
    userId: user?.idUsuario,
    activeTrip,
    activeTripLoading: loadingActiveTrip,
    navigation: pilotNavigation,
    onTripInvalidated: fetchActiveTripForPilot,
    onNotify: notify,
    onLiveTelemetry: payload => {
      const socket = liveSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 64_000) return false;
      try { socket.send(JSON.stringify({ tipo: 'telemetria', ...payload })); return true; }
      catch { return false; }
    },
  });

  // Estados para Alertas de Riesgo y WebSockets
  const [alerts, setAlerts] = useState<Alerta[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  // Estados para el Módulo de Historial y Reportes (Fase 5)
  const [historicalAlerts, setHistoricalAlerts] = useState<Alerta[]>([]);
  const [loadingHistorical, setLoadingHistorical] = useState<boolean>(false);
  const [loadingStats, setLoadingStats] = useState<boolean>(false);
  const [exportingReport, setExportingReport] = useState<'pdf' | 'excel' | null>(null);
  const [statTotalAlerts, setStatTotalAlerts] = useState<number>(0);
  const [statAlertsByTipo, setStatAlertsByTipo] = useState<Record<string, number>>({});
  const [statPilotosMasInfracciones, setStatPilotosMasInfracciones] = useState<{ nombrePiloto: string; cantidadAlertas: number }[]>([]);
  // Paginación para Historial de Alertas
  const [alertsPage, setAlertsPage] = useState<number>(1);
  const [alertsPageSize, setAlertsPageSize] = useState<number>(10);

  // Estados de Filtros
  const [filterFechaInicio, setFilterFechaInicio] = useState<string>('');
  const [filterFechaFin, setFilterFechaFin] = useState<string>('');
  const [filterPiloto, setFilterPiloto] = useState<string>('');
  const [filterTipoAlerta, setFilterTipoAlerta] = useState<string>('');

  const loadHistoricalAlerts = useCallback(async (params: Record<string, string | number>) => {
    const requestId = ++historicalRequestIdRef.current;
    try {
      setAlertsPage(1);
      setLoadingHistorical(true);
      const response = await api.get<Alerta[]>('/alertas/historico', { params });
      if (historicalRequestIdRef.current === requestId) {
        setHistoricalAlerts(response.data);
      }
      return true;
    } catch (error) {
      console.error('Error al cargar historial de alertas:', error);
      if (historicalRequestIdRef.current === requestId) {
        notify('No se pudo actualizar el historial de alertas.', 'error');
      }
      return false;
    } finally {
      if (historicalRequestIdRef.current === requestId) {
        setLoadingHistorical(false);
      }
    }
  }, [notify]);

  const fetchHistoricalAlerts = useCallback(async () => {
    const params: Record<string, string | number> = {};
    if (filterFechaInicio) params.fechaInicio = filterFechaInicio;
    if (filterFechaFin) params.fechaFin = filterFechaFin;
    if (filterPiloto) params.idUsuario = Number(filterPiloto);
    if (filterTipoAlerta) params.tipoAlerta = filterTipoAlerta;

    await loadHistoricalAlerts(params);
  }, [filterFechaInicio, filterFechaFin, filterPiloto, filterTipoAlerta, loadHistoricalAlerts]);

  const fetchUsers = useCallback(async () => {
    await Promise.resolve();
    try {
      setLoadingUsers(true);
      setCrudError(null);
      const response = await api.get<ManagedUser[]>('/usuarios');
      setUsers(response.data.filter((item) => !removedUserIdsRef.current.has(item.idUsuario)));
      if (activeTab === 'chat' && user?.tipoRol !== 'Piloto' && selectedChatPilotId === 0) {
        const firstPilot = response.data.find((candidate) => candidate.tipoRol === 'Piloto');
        if (firstPilot) {
          setSelectedChatPilotId(firstPilot.idUsuario);
          setSelectedChatPilotName(firstPilot.nombreCompleto);
        }
      }
    } catch (error) {
      console.error(error);
      setCrudError(getApiErrorMessage(error, 'No se pudieron cargar los usuarios. Verifica tus permisos.'));
    } finally {
      setLoadingUsers(false);
    }
  }, [activeTab, selectedChatPilotId, user?.tipoRol]);

  // Cargar datos al cambiar de pestaña
  useEffect(() => {
    if (activeTab === 'users' && canManageOperations) {
      queueMicrotask(() => void fetchUsers());
    } else if (activeTab === 'buses' && canMonitorOperations) {
      fetchBuses();
      queueMicrotask(() => void fetchUsers());
      fetchRoutes();
      fetchTrips();
    } else if ((activeTab === 'map' || activeTab === 'telemetry') && canMonitorOperations) {
      fetchTrips();
      fetchBuses();
      const controller = new AbortController();
      let requestInFlight = false;
      const syncActivas = async () => {
        if (document.hidden || requestInFlight) return;
        requestInFlight = true;
        const requestStartedAt = Date.now();
        try {
          const res = await api.get('/telemetria/activas', { signal: controller.signal });
          if (res?.data && Array.isArray(res.data)) {
            const updatedAt = Date.now();
            setLiveBuses((current) => mergeLiveSnapshot(current, res.data, requestStartedAt, updatedAt));
            setLastTelemetrySyncAt(updatedAt);
          }
        } catch (error) {
          if (!(isAxiosError(error) && error.code === 'ERR_CANCELED')) {
            console.warn('No se pudo sincronizar la telemetría activa:', error);
          }
        } finally {
          requestInFlight = false;
        }
      };
      const handleVisibilityChange = () => {
        if (!document.hidden) void syncActivas();
      };
      void syncActivas();
      const activasTimer = window.setInterval(() => void syncActivas(), 15000);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        controller.abort();
        window.clearInterval(activasTimer);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    } else if ((activeTab === 'map' || activeTab === 'telemetry') && user?.tipoRol === 'Piloto') {
      // El piloto consulta solamente sus viajes. La flota completa y la telemetría
      // activa pertenecen al centro de control y requieren permisos de supervisión.
      fetchTrips();
    } else if (activeTab === 'routes' && canMonitorOperations) {
      fetchRoutes();
    } else if (activeTab === 'trips' && canMonitorOperations) {
      fetchTrips();
      queueMicrotask(() => void fetchUsers());
      fetchBuses();
      fetchRoutes();
    } else if (activeTab === 'alerts' && canMonitorOperations) {
      queueMicrotask(() => void fetchHistoricalAlerts());
      fetchAlertStats();
      queueMicrotask(() => void fetchUsers()); // Para el selector de pilotos
    } else if (activeTab === 'activity' && canMonitorOperations) {
      fetchTrips();
      queueMicrotask(() => void fetchUsers());
      fetchBuses();
      fetchRoutes();
      queueMicrotask(() => void fetchHistoricalAlerts());
    } else if (activeTab === 'activity' && user?.tipoRol === 'Piloto') {
      // El historial del piloto ya viene filtrado por el backend según el usuario
      // autenticado; no se solicitan catálogos ni alertas de otros operadores.
      fetchTrips();
    }
  }, [activeTab, canManageOperations, canMonitorOperations, fetchHistoricalAlerts, fetchUsers, user?.tipoRol]);

  // Cargar viaje activo para Pilotos
  useEffect(() => {
    if (user?.tipoRol !== 'Piloto') return;

    const syncActiveTrip = () => void fetchActiveTripForPilot();
    const handleVisibilityChange = () => {
      if (!document.hidden) syncActiveTrip();
    };
    syncActiveTrip();
    const timer = window.setInterval(syncActiveTrip, 30_000);
    window.addEventListener('online', syncActiveTrip);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', syncActiveTrip);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchActiveTripForPilot, user?.tipoRol]);

  // Conectar WebSocket para todos los usuarios autenticados. Los permisos del backend
  // determinan qué eventos recibe cada rol.
  useEffect(() => {
    if (!user) return;
    const canMonitorOperations = user.tipoRol === 'Administrador' || user.tipoRol === 'SuperAdministrador' || user.tipoRol === 'Supervisor';

    if (canMonitorOperations) fetchAlerts();

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let heartbeatInterval: number | null = null;
    let shouldReconnect = true;
    let reconnectAttempt = 0;
    let lastSocketMessageAt = Date.now();

    const scheduleReconnect = () => {
      if (!shouldReconnect || reconnectTimeout) return;
      const baseDelay = Math.min(30000, 1500 * (2 ** reconnectAttempt));
      const delay = baseDelay + Math.round(Math.random() * 500);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connectWebSocket();
      }, delay);
    };

    const connectWebSocket = () => {
      if (!shouldReconnect || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
      const apiBase = api.defaults.baseURL || (import.meta.env.PROD ? '/api' : 'http://localhost:5059/api');
      const wsUrl = buildWebSocketUrl(apiBase);

      try {
        const socket = new WebSocket(wsUrl);
        ws = socket;
        liveSocketRef.current = socket;

        socket.onopen = () => {
          lastSocketMessageAt = Date.now();
          reconnectAttempt = 0;
          setWsConnected(true);
          // Consultar inmediatamente telemetría activa almacenada en memoria en el backend
          if (canMonitorOperations) {
            // Recover deletions missed while this browser was disconnected.
            api.get<ManagedUser[]>('/usuarios').then((res) => {
              if (shouldReconnect && ws === socket) {
                setUsers(res.data.filter((item) => !removedUserIdsRef.current.has(item.idUsuario)));
              }
            }).catch(() => {});
            const requestStartedAt = Date.now();
            api.get('/telemetria/activas').then((res) => {
              if (shouldReconnect && res?.data && Array.isArray(res.data)) {
                const updatedAt = Date.now();
                setLiveBuses((current) => mergeLiveSnapshot(current, res.data, requestStartedAt, updatedAt));
                setLastTelemetrySyncAt(updatedAt);
              }
            }).catch(() => {});
          }
        };

        socket.onmessage = (event) => {
          lastSocketMessageAt = Date.now();
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.tipoMensaje === 'usuario_eliminado') {
              const removedId = parsed.data?.idUsuario;
              if (Number.isSafeInteger(removedId) && removedId > 0) {
                removedUserIdsRef.current.add(removedId);
                setUsers((current) => current.filter((item) => item.idUsuario !== removedId));
              }
            } else if (parsed.tipoMensaje === 'telemetria' || parsed.tipo === 'telemetria') {
              const liveData = (parsed.data || parsed) as LiveTelemetryData;
              if (liveData && liveData.placaAutobus) {
                if (
                  liveData.placaAutobus.toUpperCase() === 'PRUEBA' ||
                  liveData.nombrePiloto?.toLowerCase().includes('administrador')
                ) {
                  return;
                }
                const receivedAt = Date.now();
                setLastTelemetrySyncAt(receivedAt);
                if (liveData.isOffline) {
                  setLiveBuses((prev) => {
                    const next = { ...prev };
                    delete next[liveData.placaAutobus];
                    return next;
                  });
                } else {
                  setLiveBuses((prev) => {
                    const next = { ...prev };
                    next[liveData.placaAutobus] = normalizeLiveTelemetry(liveData, receivedAt);
                    return next;
                  });
                }
              }
            } else if (parsed.tipoMensaje === 'piloto_offline' || parsed.tipo === 'piloto_offline' || parsed.tipo === 'logout') {
              const offData = parsed.data || parsed;
              const placa = offData?.placaAutobus;
              const pilotoNombre = offData?.nombrePiloto;
              const idUser = offData?.idUsuario;

              setLiveBuses((prev) => {
                const next = { ...prev };
                Object.keys(next).forEach((k) => {
                  const b = next[k];
                  const matchesOfflineUnit = placa
                    ? k.toLowerCase() === placa.toLowerCase()
                    : idUser
                      ? b?.idUsuario === idUser
                      : Boolean(pilotoNombre && b?.nombrePiloto?.toLowerCase() === pilotoNombre.toLowerCase());
                  if (matchesOfflineUnit) {
                    delete next[k];
                  }
                });
                return next;
              });
              setLastTelemetrySyncAt(Date.now());
            } else if (parsed.tipoMensaje === 'alerta' || parsed.tipo === 'alerta' || parsed.tipoAlerta || parsed.idAlerta) {
              const newAlert = (parsed.data || parsed) as Alerta;
              setAlerts((prev) => prev.some((alert) => alert.idAlerta === newAlert.idAlerta)
                ? prev
                : [newAlert, ...prev].slice(0, 200));
              playBeepAlert();
            } else if (parsed.tipoMensaje === 'chat' || parsed.tipo === 'chat') {
              const newMsg = parsed.data || parsed;
              const targetChannel = chatModeRef.current === 'general' ? 0 : (user?.tipoRol === 'Piloto' ? user.idUsuario : selectedChatPilotIdRef.current);
              if (newMsg && newMsg.idPilotoCanal === targetChannel) {
                setChatMessages((prev) => {
                  if (prev.some((m) => m.idMensaje === newMsg.idMensaje)) return prev;
                  return [...prev, newMsg];
                });
                setTimeout(() => {
                  if (chatMessagesContainerRef.current) {
                    const { scrollTop, scrollHeight, clientHeight } = chatMessagesContainerRef.current;
                    const isNearBottom = scrollHeight - scrollTop - clientHeight < 250;
                    if (isNearBottom) {
                      scrollToChatBottom('smooth');
                    }
                  }
                }, 60);
              }
            } else if (parsed.tipoMensaje === 'chat_delete' || parsed.tipo === 'chat_delete') {
              const deletedId = parsed.idMensaje || parsed.data?.idMensaje;
              if (deletedId) {
                setChatMessages((prev) => prev.filter((m) => m.idMensaje !== deletedId));
              }
            } else if (parsed.tipoMensaje === 'chat_clear' || parsed.tipo === 'chat_clear') {
              const clearedChan = parsed.idPilotoCanal !== undefined ? parsed.idPilotoCanal : parsed.data?.idPilotoCanal;
              const targetChannel = chatModeRef.current === 'general' ? 0 : (user?.tipoRol === 'Piloto' ? user.idUsuario : selectedChatPilotIdRef.current);
              if (clearedChan === -1 || clearedChan === targetChannel) {
                setChatMessages([]);
              }
            }
          } catch (e) {
            console.error("Error al recibir datos del WebSocket", e);
          }
        };

        socket.onerror = () => {
          socket.close();
        };

        socket.onclose = () => {
          if (liveSocketRef.current === socket) liveSocketRef.current = null;
          if (ws !== socket) return;
          ws = null;
          setWsConnected(false);
          scheduleReconnect();
        };
      } catch (err) {
        console.warn("Fallo al inicializar WebSocket:", err);
        scheduleReconnect();
      }
    };

    const handleOnline = () => {
      reconnectAttempt = 0;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      connectWebSocket();
    };

    connectWebSocket();
    heartbeatInterval = window.setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastSocketMessageAt > 60_000) { ws.close(); return; }
        try { ws.send(JSON.stringify({ tipo: 'ping' })); } catch { ws.close(); }
      }
    }, 20_000);
    window.addEventListener('online', handleOnline);

    return () => {
      shouldReconnect = false;
      liveSocketRef.current = null;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (ws) ws.close();
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

  // Obtener ID del canal activo
  const getActiveChatChannelId = useCallback((): number => {
    if (chatMode === 'general') return 0;
    return user?.tipoRol === 'Piloto' ? user.idUsuario : selectedChatPilotId;
  }, [chatMode, selectedChatPilotId, user?.idUsuario, user?.tipoRol]);

  // Cargar historial de chat según modo
  const fetchChatMessages = useCallback(async (explicitChannelId?: number, silent = false) => {
    const requestId = ++chatRequestIdRef.current;
    const isPilot = user?.tipoRol === 'Piloto';
    const channelId = explicitChannelId !== undefined ? explicitChannelId : getActiveChatChannelId();

    // Si es modo privado y es Admin pero aún no hay piloto seleccionado, limpiar mensajes
    if (chatMode === 'private' && !isPilot && channelId === 0) {
      setChatMessages([]);
      setChatLoading(false);
      return;
    }

    try {
      if (!silent) setChatLoading(true);
      const url = (chatMode === 'general' || channelId === 0) ? '/chat/general' : `/chat/canal/${channelId}`;
      const res = await api.get(url);
      if (chatRequestIdRef.current === requestId && Array.isArray(res.data)) {
        setChatMessages(res.data);
      }
    } catch (e) {
      console.warn('Error cargando historial de chat:', e);
      if (!silent && chatRequestIdRef.current === requestId) {
        notify('No se pudo cargar la conversación seleccionada.', 'error');
      }
    } finally {
      if (!silent && chatRequestIdRef.current === requestId) {
        setChatLoading(false);
      }
    }
  }, [chatMode, getActiveChatChannelId, notify, user?.tipoRol]);

  // Cargar usuarios al entrar a chat
  useEffect(() => {
    if (activeTab === 'chat' && user?.tipoRol !== 'Piloto') {
      queueMicrotask(() => void fetchUsers());
    }
  }, [activeTab, user, fetchUsers]);

  useEffect(() => {
    if (activeTab !== 'chat') return;

    const sync = () => void fetchChatMessages(undefined, true);
    const handleVisibility = () => {
      if (!document.hidden) sync();
    };
    queueMicrotask(() => void fetchChatMessages());
    const timer = window.setInterval(sync, 10_000);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeTab, fetchChatMessages]);

  // Auto-scroll al fondo al cargar mensajes o cambiar de canal / pestaña
  useEffect(() => {
    if (activeTab === 'chat' && chatMessages.length > 0) {
      const channelKey = chatMode === 'general' ? 'general' : `pilot_${selectedChatPilotId}`;
      const savedScroll = channelScrollPositionsRef.current[channelKey];

      const timer = setTimeout(() => {
        if (chatMessagesContainerRef.current) {
          if (typeof savedScroll === 'number' && savedScroll > 0) {
            chatMessagesContainerRef.current.scrollTop = savedScroll;
          } else {
            chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
          }
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [chatMessages, chatMode, selectedChatPilotId, activeTab]);

  const handleSendChatMessage = async (textToSend?: string, tipo: string = 'texto') => {
    if (user?.tipoRol === 'Supervisor') {
      notify('El perfil Supervisor puede auditar el chat, pero no enviar mensajes.', 'warning');
      return;
    }
    const content = (textToSend || chatInput).trim();
    if (!content) return;

    const channelId = getActiveChatChannelId();
    const isPilot = user?.tipoRol === 'Piloto';

    if (chatMode === 'private' && !isPilot && channelId === 0) {
      notify('Selecciona un piloto para abrir su canal con despacho.', 'warning');
      return;
    }

    const targetName = channelId === 0
      ? 'Canal General de la Flota'
      : (isPilot ? user.nombreCompleto : selectedChatPilotName);

    try {
      setChatSending(true);
      const previousSend = chatSendIds.current.get(chatDraftKey);
      const idCliente = previousSend?.content === content ? previousSend.id : crypto.randomUUID();
      chatSendIds.current.set(chatDraftKey, { content, id: idCliente });
      const res = await api.post('/chat', {
        idCliente,
        idPilotoCanal: channelId,
        nombrePilotoCanal: targetName,
        contenido: content,
        tipoContenido: tipo
      });
      chatSendIds.current.delete(chatDraftKey);
      if (!textToSend) setChatDrafts(previous => ({ ...previous, [chatDraftKey]: previous[chatDraftKey]?.trim() === content ? '' : previous[chatDraftKey] }));
      const visibleChannel = chatModeRef.current === 'general' ? 0 : user?.tipoRol === 'Piloto' ? user.idUsuario : selectedChatPilotIdRef.current;
      if (res.data && visibleChannel === channelId) {
        setChatMessages((prev) => {
          if (prev.some((m) => m.idMensaje === res.data.idMensaje)) return prev;
          return [...prev, res.data];
        });
        setTimeout(() => scrollToChatBottom('smooth'), 50);
      }
    } catch (e) {
      const detail = isAxiosError<{ mensaje?: string }>(e) ? e.response?.data?.mensaje : undefined;
      notify(detail || 'No se confirmó el envío. El borrador se conserva para reintentar.', 'error');
    } finally {
      setChatSending(false);
    }
  };

  // Pitido acústico nativo (Web Audio API)
  function playBeepAlert() {
    try {
      const AudioContextConstructor = window.AudioContext ??
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioCtx = new AudioContextConstructor();
      const emitTone = (timeOffset: number, frequency: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.35, audioCtx.currentTime + timeOffset);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + timeOffset + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + timeOffset);
        osc.stop(audioCtx.currentTime + timeOffset + duration);
      };
      emitTone(0, 880, 0.15);
      emitTone(0.2, 880, 0.15);
    } catch (e) {
      console.warn("No se pudo reproducir audio de alerta.", e);
    }
  }



  // Consultar Autobuses (GET)
  async function fetchBuses() {
    try {
      setLoadingBuses(true);
      setCrudError(null);
      const response = await api.get<Autobus[]>('/autobuses');
      setBuses(response.data);
    } catch (error) {
      console.error(error);
      setCrudError(getApiErrorMessage(error, 'No se pudieron cargar los autobuses.'));
    } finally {
      setLoadingBuses(false);
    }
  }

  // Abrir modal de creación de Autobús
  const openCreateBusModal = () => {
    setManageBusAssignment(true);
    busEditingSnapshot.current = null;
    void Promise.all([fetchUsers(), fetchTrips()]);
    setEditingBusId(null);
    setFormPlaca('');
    setFormMarcaModelo('');
    setFormEstadoBus('Activo');
    setFormPilotoAsignado(0);
    setFormRutaAsignadaBus(0);
    setCrudError(null);
    setShowBusModal(true);
  };

  // Abrir modal de edición de Autobús
  const openEditBusModal = async (bus: Autobus) => {
    setManageBusAssignment(false);
    let freshBus: Autobus;
    try {
      const [response] = await Promise.all([api.get<Autobus>(`/autobuses/${bus.idAutobus}`), fetchUsers(), fetchTrips()]);
      freshBus = response.data;
    } catch {
      setCrudError('No se pudo verificar la unidad. Vuelve a abrirla cuando recuperes conexión.');
      return;
    }
    busEditingSnapshot.current = freshBus;
    bus = freshBus;
    setEditingBusId(bus.idAutobus);
    setFormPlaca(bus.placa);
    setFormMarcaModelo(bus.marcaModelo || '');
    setFormEstadoBus(bus.estado);
    setFormPilotoAsignado(bus.idPilotoAsignado ?? 0);
    setFormRutaAsignadaBus(bus.idRutaAsignada ?? 0);
    setCrudError(null);
    setShowBusModal(true);
  };

  // Guardar Autobús (Crear/Editar) y Asignar Piloto
  const handleSaveBus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busSaveInFlightRef.current) return;
    if (!formPlaca || !formEstadoBus) {
      setCrudError('La placa y el estado son requeridos.');
      return;
    }

    if (formPilotoAsignado > 0 && formEstadoBus !== 'Activo') {
      setCrudError('Solo puedes asignar un piloto a un autobús activo.');
      return;
    }

    busSaveInFlightRef.current = true;
    if (editingBusId != null && manageBusAssignment && busEditingSnapshot.current?.idViajeActivo
      && busEditingSnapshot.current.idPilotoAsignado !== (formPilotoAsignado || null)
      && !window.confirm('Cambiar o retirar al conductor finalizará el viaje actual y cerrará su chat público. ¿Continuar con el relevo?')) {
      busSaveInFlightRef.current = false;
      return;
    }
    setBusSaving(true);
    try {
      setCrudError(null);

      // La disponibilidad puede cambiar mientras el modal permanece abierto. Se valida
      // contra el servidor justo antes de guardar para no depender de datos obsoletos.
      if (formPilotoAsignado > 0) {
        const [usersResponse, tripsResponse] = await Promise.all([
          api.get<ManagedUser[]>('/usuarios'),
          api.get<Viaje[]>('/viajes')
        ]);
        setUsers(usersResponse.data.filter((item) => !removedUserIdsRef.current.has(item.idUsuario)));
        setTrips(tripsResponse.data);

        const selectedPilot = usersResponse.data.find(
          candidate => candidate.idUsuario === formPilotoAsignado
        );
        if (!selectedPilot) {
          setCrudError('El piloto seleccionado ya no existe o no está disponible.');
          return;
        }
        if (selectedPilot.estado !== 'Activo') {
          setCrudError('El piloto seleccionado está inactivo. Actívalo antes de asignarle una unidad.');
          return;
        }

        const pilotActiveTrip = tripsResponse.data.find(
          trip => trip.idUsuario === formPilotoAsignado && trip.estadoViaje === 'En Curso'
        );
        if (pilotActiveTrip && pilotActiveTrip.idAutobus !== editingBusId) {
          setCrudError(`El piloto ya está asignado a la unidad ${pilotActiveTrip.placaAutobus}. Finaliza ese viaje antes de reasignarlo.`);
          return;
        }
      }

      const assignmentPayload = {
        idPilotoAsignado: formPilotoAsignado > 0 ? formPilotoAsignado : null,
        idRutaAsignada: formPilotoAsignado > 0 && formRutaAsignadaBus > 0 ? formRutaAsignadaBus : null
      };

      if (editingBusId === null) {
        await api.post('/autobuses', {
          placa: formPlaca,
          marcaModelo: formMarcaModelo || null,
          estado: formEstadoBus,
          ...assignmentPayload
        });
      } else {
        await api.put(`/autobuses/${editingBusId}`, {
          placa: formPlaca,
          marcaModelo: formMarcaModelo || null,
          estado: formEstadoBus,
          gestionarAsignacion: manageBusAssignment,
          version: busEditingSnapshot.current?.version,
          idViajeEsperado: busEditingSnapshot.current?.idViajeActivo ?? null,
          ...assignmentPayload
        });
      }

      setShowBusModal(false);
      await Promise.all([fetchBuses(), fetchTrips()]);
    } catch (error) {
      const saveError = getApiErrorMessage(error, 'Error al guardar el autobús.');
      await Promise.allSettled([fetchBuses(), fetchTrips(), fetchUsers()]);
      setCrudError(saveError);
    } finally {
      busSaveInFlightRef.current = false;
      setBusSaving(false);
    }
  };

  // Eliminar Autobús (DELETE)
  const handleDeleteBus = (id: number) => {
    requestConfirmation({
      title: 'Eliminar Autobús',
      message: '¿Estás seguro de que deseas eliminar permanentemente este autobús de la flota? Se borrarán sus datos asociados.',
      confirmText: 'Eliminar Autobús',
      cancelText: 'Cancelar',
      isDanger: true,
      onConfirm: async () => {
        try {
          setCrudError(null);
          await api.delete(`/autobuses/${id}`);
          fetchBuses();
        } catch (error) {
          setCrudError(getApiErrorMessage(error, 'Error al eliminar el autobús.'));
        }
      }
    });
  };

  // Consultar Rutas para Despacho (GET)
  async function fetchRoutes() {
    try {
      const response = await api.get<Ruta[]>('/rutas');
      setRoutes(response.data);
    } catch (error) {
      console.warn('No se pudieron cargar las rutas para despacho:', error);
    }
  }

  const openCreateRouteModal = () => {
    setCrudError(null);
    setRouteTripContext(null);
    setFormRouteName('');
    setFormRouteOrigin('');
    setFormRouteDestination('');
    setShowRouteModal(true);
  };

  const openSaveTripAsRouteModal = (trip: Viaje) => {
    if (trip.destinoLatitud == null || trip.destinoLongitud == null) {
      notify('Este viaje todavía no tiene un destino GPS que se pueda guardar.', 'warning');
      return;
    }
    const destination = trip.destinoRuta || trip.destinoNombre || 'Destino del viaje';
    setCrudError(null);
    setRouteTripContext({
      idViaje: trip.idViaje,
      destinoLatitud: trip.destinoLatitud,
      destinoLongitud: trip.destinoLongitud,
    });
    setFormRouteName(`Ruta a ${destination}`.slice(0, 100));
    setFormRouteOrigin(trip.origenRuta || 'Punto de salida');
    setFormRouteDestination(destination.slice(0, 100));
    setShowTripDetailModal(false);
    setShowRouteModal(true);
  };

  const handleSaveAdminRoute = async (event: React.FormEvent) => {
    event.preventDefault();
    if (routeSaving) return;
    try {
      setRouteSaving(true);
      setCrudError(null);
      const routePayload = {
        nombreRuta: formRouteName.trim(),
        origen: formRouteOrigin.trim(),
        destino: formRouteDestination.trim(),
      };
      if (routeTripContext) {
        const response = await api.post<Viaje>(`/viajes/${routeTripContext.idViaje}/guardar-ruta`, {
          ...routePayload,
          destinoLatitud: routeTripContext.destinoLatitud,
          destinoLongitud: routeTripContext.destinoLongitud,
        });
        setTrips((current) => current.map((trip) => trip.idViaje === response.data.idViaje ? response.data : trip));
        setSelectedTripDetail(response.data);
      } else {
        await api.post('/rutas', routePayload);
      }
      await Promise.all([fetchRoutes(), fetchTrips()]);
      setShowRouteModal(false);
      setRouteTripContext(null);
      notify(`Ruta "${formRouteName.trim()}" guardada y disponible para despachos.`, 'success');
    } catch (error) {
      const message = getApiErrorMessage(error, 'No se pudo guardar la ruta.');
      setCrudError(message);
      notify(message, 'error');
    } finally {
      setRouteSaving(false);
    }
  };

  const handleSavePilotRoute = useCallback(async (route: {
    nombreRuta: string;
    origen: string;
    destino: string;
    origenLatitud?: number;
    origenLongitud?: number;
    destinoLatitud: number;
    destinoLongitud: number;
  }) => {
    const currentTrip = activeTripRef.current;
    if (!currentTrip) {
      const message = 'Necesitas un viaje activo para guardar y asociar esta ruta.';
      notify(message, 'warning');
      throw new Error(message);
    }

    try {
      const response = await api.post<Viaje>(`/viajes/${currentTrip.idViaje}/guardar-ruta`, route);
      activeTripRef.current = response.data;
      setActiveTrip(response.data);
      setTrips((current) => current.map((trip) => trip.idViaje === response.data.idViaje ? response.data : trip));
      notify(`Ruta "${response.data.nombreRuta || route.nombreRuta}" guardada en el viaje actual.`, 'success');
    } catch (error) {
      const message = getApiErrorMessage(error, 'No se pudo guardar la ruta del viaje.');
      notify(message, 'error');
      throw error;
    }
  }, [notify]);

  // Consultar Viajes (GET)
  async function fetchTrips() {
    try {
      setLoadingTrips(true);
      setCrudError(null);
      const response = await api.get<Viaje[]>('/viajes');
      setTrips(response.data);
    } catch (error) {
      console.error(error);
      setCrudError(getApiErrorMessage(error, 'No se pudieron cargar los viajes.'));
    } finally {
      setLoadingTrips(false);
    }
  }

  // Abrir Modal de Despacho de Viajes
  const openCreateTripModal = async () => {
    setCrudError(null);
    setFormTripPiloto(0);
    setFormTripBus(0);
    setFormTripRoute(0);
    try {
      setLoadingTrips(true);
      await Promise.all([fetchUsers(), fetchBuses(), fetchRoutes()]);
      setShowTripModal(true);
    } catch {
      setCrudError('Error al cargar datos maestros para el despacho.');
    } finally {
      setLoadingTrips(false);
    }
  };

  // Guardar/Registrar Despacho de Viaje (POST)
  const handleSaveTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dispatchBusy.current) return;
    if (!formTripPiloto || !formTripBus) {
      setCrudError('El Piloto y el Autobús son obligatorios para el despacho.');
      return;
    }
    const signature = `${formTripPiloto}:${formTripBus}:${formTripRoute}`;
    if (dispatchOperation.current?.signature !== signature) dispatchOperation.current = { signature, id: crypto.randomUUID() };
    dispatchBusy.current = true;
    try {
      setCrudError(null);
      await api.post('/viajes', {
        idOperacion: dispatchOperation.current.id,
        idUsuario: Number(formTripPiloto),
        idAutobus: Number(formTripBus),
        idRuta: formTripRoute && Number(formTripRoute) > 0 ? Number(formTripRoute) : null
      });
      dispatchOperation.current = null;
      setShowTripModal(false);
      fetchTrips();
    } catch (error) {
      setCrudError(getApiErrorMessage(error, 'Error al despachar el viaje.'));
    } finally {
      dispatchBusy.current = false;
    }
  };

  // Finalizar Viaje (POST)
  const handleFinalizeTrip = async (id: number) => {
    requestConfirmation({
      title: 'Finalizar viaje',
      message: 'Se cerrará el recorrido activo y quedará registrado en el historial. ¿Deseas continuar?',
      confirmText: 'Finalizar viaje',
      cancelText: 'Mantener activo',
      isDanger: false,
      onConfirm: async () => {
        try {
          setCrudError(null);
          await api.post(`/viajes/${id}/finalizar`);
          notify('El viaje se finalizó correctamente.', 'success');
          if (user?.tipoRol === 'Piloto') {
            activeTripRef.current = null;
            setActiveTrip(null);
            setPilotNavigation(null);
            await fetchActiveTripForPilot();
          }
          await fetchTrips();
        } catch (error) {
          const message = getApiErrorMessage(error, 'Error al finalizar el viaje.');
          setCrudError(message);
          notify(message, 'error');
        }
      },
    });
  };

  const createPublicTripLink = async (trip: Viaje, rotate = false) => {
    if (creatingPublicLink) return;
    if (rotate && !window.confirm('El enlace anterior dejará de funcionar. Su historial interno se conserva. ¿Rotar enlace?')) return;
    try {
      setCreatingPublicLink(true);
      const response = await api.post<PublicTripAccess>(`/viajes/${trip.idViaje}/acceso-publico`, { chatHabilitado: true, rotar: rotate });
      if (!response.data.token) throw new Error('El servidor no devolvió el código público.');
      const link = `${window.location.origin}/viaje/${response.data.token}`;
      const qr = await QRCode.toDataURL(link, {
        width: 260,
        margin: 2,
        color: { dark: '#0d2026', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      setPublicTripLink(link);
      setPublicTripQr(qr);
      notify(rotate ? 'Enlace rotado. El anterior quedó revocado.' : 'Enlace preparado sin interrumpir los accesos existentes.', 'success');
    } catch (error) {
      notify(getApiErrorMessage(error, 'No se pudo generar el enlace del viaje.'), 'error');
    } finally {
      setCreatingPublicLink(false);
    }
  };

  const copyPublicTripLink = async () => {
    if (!publicTripLink) return;
    try {
      await navigator.clipboard.writeText(publicTripLink);
      notify('Enlace copiado al portapapeles.', 'success');
    } catch {
      notify('No fue posible copiar automáticamente. Selecciona el enlace manualmente.', 'warning');
    }
  };

  // Consultar Alertas de Riesgo Recientes (GET)
  async function fetchAlerts() {
    try {
      setLoadingAlerts(true);
      const response = await api.get<Alerta[]>('/alertas');
      setAlerts(response.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingAlerts(false);
    }
  }


  // Cargar estadísticas agregadas (Fase 5)
  async function fetchAlertStats() {
    try {
      setLoadingStats(true);
      const response = await api.get('/alertas/estadisticas');
      const data = response.data;
      setStatTotalAlerts(data.totalAlertas);
      setStatAlertsByTipo(data.alertasPorTipo);
      setStatPilotosMasInfracciones(data.pilotosMasInfracciones);
    } catch (error) {
      console.error('Error al cargar estadísticas:', error);
    } finally {
      setLoadingStats(false);
    }
  }

  // Limpiar filtros del historial
  const handleClearFilters = async () => {
    setFilterFechaInicio('');
    setFilterFechaFin('');
    setFilterPiloto('');
    setFilterTipoAlerta('');
    setAlertsPage(1);
    const refreshed = await loadHistoricalAlerts({});
    if (refreshed) {
      notify('Filtros eliminados. Se muestra todo el historial.', 'success');
    }
  };

  const downloadAlertReport = async (format: 'pdf' | 'excel') => {
    const params: Record<string, string | number> = {};
    if (filterFechaInicio) params.fechaInicio = filterFechaInicio;
    if (filterFechaFin) params.fechaFin = filterFechaFin;
    if (filterPiloto) params.idUsuario = Number(filterPiloto);
    if (filterTipoAlerta) params.tipoAlerta = filterTipoAlerta;

    try {
      setExportingReport(format);
      const response = await api.get<Blob>(`/alertas/exportar/${format}`, {
        params,
        responseType: 'blob',
      });
      const fallbackName = `alertas-${new Date().toISOString().slice(0, 10)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      const disposition = String(response.headers['content-disposition'] || '');
      const serverName = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1];
      const fileName = decodeURIComponent(serverName || fallbackName).replace(/[\\/:*?"<>|]/g, '-');
      const objectUrl = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      notify(`Reporte ${format.toUpperCase()} generado correctamente.`, 'success');
    } catch (error) {
      console.error(`Error al exportar ${format}:`, error);
      notify(`No se pudo generar el reporte ${format.toUpperCase()}.`, 'error');
    } finally {
      setExportingReport(null);
    }
  };

  const handleExportPdf = () => downloadAlertReport('pdf');
  const handleExportExcel = () => downloadAlertReport('excel');


  // Activar/Desactivar Usuario (PATCH)
  const handleToggleEstado = async (targetUser: ManagedUser) => {
    const nuevoEstado = targetUser.estado === 'Activo' ? 'Inactivo' : 'Activo';
    try {
      setCrudError(null);
      await api.patch(`/usuarios/${targetUser.idUsuario}/estado`, { estado: nuevoEstado });
      setUsers((prev) =>
        prev.map((u) => (u.idUsuario === targetUser.idUsuario ? { ...u, estado: nuevoEstado } : u))
      );
    } catch (error) {
      setCrudError(getApiErrorMessage(error, 'Error al cambiar el estado del usuario.'));
    }
  };

  // Eliminar Usuario (DELETE)
  const handleDeleteUser = (targetUser: ManagedUser) => {
    if (targetUser.usuarioLogin === 'superadmin' || targetUser.usuarioLogin === 'admin') {
      requestConfirmation({
        title: 'Acción No Permitida',
        message: 'No es posible eliminar las cuentas maestras de Administración del sistema.',
        confirmText: 'Entendido',
        cancelText: 'Cerrar',
        isDanger: false,
        onConfirm: () => {}
      });
      return;
    }
    requestConfirmation({
      title: 'Eliminar Usuario',
      message: `¿Estás seguro de que deseas eliminar permanentemente al usuario "${targetUser.nombreCompleto}" (${targetUser.usuarioLogin})? Se borrarán sus accesos y datos vinculados.`,
      confirmText: 'Eliminar Usuario',
      cancelText: 'Cancelar',
      isDanger: true,
      onConfirm: async () => {
        try {
          setCrudError(null);
          await api.delete(`/usuarios/${targetUser.idUsuario}`);
          fetchUsers();
        } catch (error) {
          setCrudError(getApiErrorMessage(error, 'Error al eliminar el usuario.'));
        }
      }
    });
  };

  // Abrir Modal para Crear
  const openCreateModal = () => {
    setEditingUserId(null);
    setFormNombre('');
    setFormLogin('');
    setFormRol('Piloto');
    setFormContrasena('');
    setFormEstado('Activo');
    setCrudError(null);
    setShowModal(true);
  };

  // Abrir Modal para Editar
  const openEditModal = (targetUser: ManagedUser) => {
    setEditingUserId(targetUser.idUsuario);
    userEditingVersion.current = targetUser.version;
    setFormNombre(targetUser.nombreCompleto);
    setFormLogin(targetUser.usuarioLogin);
    setFormRol(targetUser.tipoRol);
    setFormContrasena(''); // Se deja vacío para que solo se cambie si escriben
    setFormEstado(targetUser.estado);
    setCrudError(null);
    setShowModal(true);
  };

  // Procesar Guardado (Crear/Editar)
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNombre || !formLogin || !formRol) {
      setCrudError('Nombre, Usuario y Rol son requeridos.');
      return;
    }

    try {
      setCrudError(null);
      if (editingUserId === null) {
        // Crear Usuario
        if (!formContrasena) {
          setCrudError('La contraseña es obligatoria para nuevos usuarios.');
          return;
        }
        await api.post('/usuarios', {
          nombreCompleto: formNombre,
          usuarioLogin: formLogin,
          tipoRol: formRol,
          contrasena: formContrasena,
          estado: formEstado,
        });
      } else {
        // Editar Usuario
        await api.put(`/usuarios/${editingUserId}`, {
          version: userEditingVersion.current,
          nombreCompleto: formNombre,
          usuarioLogin: formLogin,
          tipoRol: formRol,
          contrasena: formContrasena || null, // Opcional
          estado: formEstado,
        });
      }
      setShowModal(false);
      fetchUsers(); // Recargar lista
    } catch (error) {
      setCrudError(getApiErrorMessage(error, 'Error al guardar el usuario.'));
    }
  };

  return (
    <div className="app-shell" style={containerStyle}>
      <DashboardSidebar
        activeTab={activeTab}
        isDark={isDark}
        role={user?.tipoRol}
        userName={user?.nombreCompleto}
        onTabChange={setActiveTab}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
      />


      {/* ÁREA DE CONTENIDO PRINCIPAL */}
      <main className="main-content" style={mainContentWrapperStyle}>
        {!['map', 'telemetry', 'alerts', 'activity', 'users', 'routes', 'buses', 'chat'].includes(activeTab) && (
          <DashboardHeader activeTab={activeTab} isDark={isDark} />
        )}

        {user?.tipoRol === 'Piloto' && (
          <PilotTrackingBar
            activeTrip={activeTrip}
            loading={loadingActiveTrip}
            tracking={pilotTracking}
          />
        )}


        {/* VISTA DE TRACKING SPLIT-SCREEN (MAPA + LISTA DE UNIDADES SAAS) */}
        {(activeTab === 'map' || activeTab === 'telemetry') && (
          <div className={`ops-live${canMonitorOperations ? '' : ' is-pilot'}`}>
            {canMonitorOperations && (() => {
              const fleet = getTrackingFleet();
              const isTracking = (b: LiveTelemetryData) => !b.isPrivacyMode && isTelemetryFresh(b, freshnessTimestamp) && hasValidCoordinates(b.latitud, b.longitud);
              const trackingCount = fleet.filter(isTracking).length;
              const privacyCount = getDeduplicatedLiveBuses(liveBuses).filter(b => b.isPrivacyMode).length;
              const noSignalCount = fleet.filter(b => !b.isPrivacyMode && !isTracking(b)).length;
              const speedingCount = fleet.filter(b => isTracking(b) && (b.velocidadKmh || 0) > 80).length;
              const query = trackingSearchQuery.trim().toLowerCase();
              const visible = (trackingTabFilter === 'active' ? fleet.filter(isTracking) : fleet).filter(b => !query
                || b.placaAutobus?.toLowerCase().includes(query)
                || b.nombrePiloto?.toLowerCase().includes(query)
                || b.nombreRuta?.toLowerCase().includes(query));
              const routeLabel = (b: LiveTelemetryData) => b.isOffline
                ? (b.marcaModelo || 'Sin conexión')
                : (b.destinoNombre ? `Hacia ${b.destinoNombre}` : (b.nombreRuta && b.nombreRuta !== 'N/D' && b.nombreRuta !== 'Sin Ruta Asignada' ? b.nombreRuta : 'Sin ruta asignada'));

              return (
                <aside className="ops-rail" aria-label="Unidades de la flota">
                  <div className="ops-rail-head">
                    <h1>Flota en vivo</h1>
                    <span className="ops-sync"><Radio size={13} aria-hidden="true" />
                      {lastTelemetrySyncAt ? new Date(lastTelemetrySyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sin sincronizar'}
                    </span>
                  </div>

                  <div className="ops-chips">
                    <span className="ops-chip is-ok">{trackingCount} en línea</span>
                    {noSignalCount > 0 && <span className="ops-chip is-warn">{noSignalCount} sin GPS</span>}
                    {speedingCount > 0 && <span className="ops-chip is-alert">{speedingCount} con exceso</span>}
                    {privacyCount > 0 && <span className="ops-chip">{privacyCount} en privacidad</span>}
                  </div>

                  <label className="ops-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      placeholder="Placa, piloto o ruta"
                      aria-label="Buscar unidad, piloto o ruta"
                      value={trackingSearchQuery}
                      onChange={(e) => setTrackingSearchQuery(e.target.value)}
                    />
                  </label>

                  <div className="ops-segment" role="group" aria-label="Qué unidades mostrar">
                    <button type="button" aria-pressed={trackingTabFilter === 'active'} onClick={() => setTrackingTabFilter('active')}>
                      En ruta <span>{trackingCount}</span>
                    </button>
                    <button type="button" aria-pressed={trackingTabFilter === 'all'} onClick={() => setTrackingTabFilter('all')}>
                      Toda la flota <span>{fleet.length}</span>
                    </button>
                  </div>

                  <ul className="ops-list">
                    {visible.length === 0 && (
                      <li className="ops-empty">
                        {query ? 'Ninguna unidad coincide con la búsqueda.' : (trackingTabFilter === 'active' ? 'No hay unidades transmitiendo ahora.' : 'Aún no hay unidades registradas.')}
                      </li>
                    )}
                    {visible.map((bus) => {
                      const hasPosition = isTracking(bus);
                      const speed = bus.velocidadKmh || 0;
                      const state = !hasPosition ? 'off' : speed > 80 ? 'alert' : speed > 50 ? 'warn' : 'ok';
                      const statusText = bus.isPrivacyMode ? 'Privacidad' : bus.isOffline ? 'Fuera de línea' : !isTelemetryFresh(bus, freshnessTimestamp) ? 'Sin señal' : 'Sin GPS';
                      const content = (
                        <>
                          <span className="ops-unit-top">
                            <strong>{bus.placaAutobus}</strong>
                            {hasPosition
                              ? <span className="ops-speed" style={speedChipColors(speed)}>{speed} km/h</span>
                              : <span className="ops-speed is-off">{statusText}</span>}
                          </span>
                          <span className="ops-unit-sub">{bus.nombrePiloto || 'Sin piloto'} · {routeLabel(bus)}</span>
                        </>
                      );
                      return (
                        <li key={bus.placaAutobus}>
                          {hasPosition ? (
                            <button
                              type="button"
                              className="ops-unit"
                              data-state={state}
                              aria-pressed={focusedBusPlaca === bus.placaAutobus}
                              aria-label={`Ver ${bus.placaAutobus} en el mapa`}
                              onClick={() => setFocusedBusPlaca(bus.placaAutobus)}
                            >
                              {content}
                            </button>
                          ) : (
                            <div className="ops-unit" data-state={state}>{content}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </aside>
              );
            })()}

            <section className="ops-map" aria-label="Mapa en vivo">
              <GoogleMapWeb
                buses={(() => {
                  const activeMap = new Map<string, LiveTelemetryData>();
                  const now = freshnessTimestamp;
                  getDeduplicatedLiveBuses(liveBuses).forEach((bus) => {
                    const isFresh = isTelemetryFresh(bus, now);
                    if (
                      bus &&
                      bus.placaAutobus &&
                      !bus.isPrivacyMode &&
                      !bus.isOffline &&
                      isFresh &&
                      hasValidCoordinates(bus.latitud, bus.longitud)
                    ) {
                      activeMap.set(bus.placaAutobus, bus);
                    }
                  });
                  return Array.from(activeMap.values());
                })()}
                privacyBusesList={(() => {
                  const privList: LiveTelemetryData[] = [];
                  getDeduplicatedLiveBuses(liveBuses).forEach((bus) => {
                    if (bus && bus.placaAutobus && bus.isPrivacyMode) {
                      privList.push(bus);
                    }
                  });
                  trips
                    .filter((t) => t.estadoViaje === 'En Curso')
                    .forEach((t) => {
                      const liveBus = liveBuses[t.placaAutobus];
                      if (!liveBus || liveBus.isPrivacyMode || !hasValidCoordinates(liveBus.latitud, liveBus.longitud)) {
                        if (!privList.some((p) => p.placaAutobus === t.placaAutobus)) {
                          privList.push({
                            placaAutobus: t.placaAutobus,
                            nombrePiloto: t.nombrePiloto,
                            nombreRuta: t.nombreRuta || 'Ruta Principal',
                            isPrivacyMode: Boolean(liveBus?.isPrivacyMode),
                            locationStatus: liveBus?.isPrivacyMode ? 'privacy' : 'unavailable',
                            velocidadKmh: 0,
                            latitud: 0,
                            longitud: 0,
                            fechaHoraDispositivo: new Date().toISOString()
                          });
                        }
                      }
                    });
                  return privList;
                })()}
                userRole={user?.tipoRol}
                selectedBusPlaca={focusedBusPlaca}
                onSelectBus={setFocusedBusPlaca}
                activeLiveRoutePlaca={activeLiveRoutePlaca}
                onToggleLiveRoute={handleToggleLiveRoute}
                theme={theme}
                onNotify={notify}
                pilotTracking={pilotTracking}
                onPilotNavigationChange={destination => setPilotNavigation(destination ? { ...destination,
                  tripId: activeTripRef.current?.idViaje, revision: activeTripRef.current?.revisionDestino ?? 0 } : null)}
                activeTripId={activeTrip?.idViaje ?? null}
                activeTripRouteName={activeTrip?.nombreRuta ?? null}
                onSavePilotRoute={handleSavePilotRoute}
              />

              {canMonitorOperations && (() => {
                const focusedBus = (focusedBusPlaca ? liveBuses[focusedBusPlaca] : undefined)
                  || Object.values(liveBuses).find(b => !b.isPrivacyMode && hasValidCoordinates(b.latitud, b.longitud));
                if (!focusedBus) return null;

                const hasPosition = !focusedBus.isPrivacyMode && hasValidCoordinates(focusedBus.latitud, focusedBus.longitud);
                const speed = focusedBus.velocidadKmh || 0;
                const hasNavRoute = Boolean(hasPosition && focusedBus.isTripActive && hasValidCoordinates(focusedBus.destinoLat, focusedBus.destinoLng));
                const showingRoute = activeLiveRoutePlaca === focusedBus.placaAutobus;

                return (
                  <div className="ops-focus" data-state={!hasPosition ? 'off' : speed > 80 ? 'alert' : speed > 50 ? 'warn' : 'ok'}>
                    <div className="ops-focus-id">
                      <span>{focusedBus.nombrePiloto || 'Sin piloto'}</span>
                      <strong>{focusedBus.placaAutobus}</strong>
                      <span>{focusedBus.destinoNombre ? `Hacia ${focusedBus.destinoNombre}` : (focusedBus.nombreRuta || 'Sin ruta asignada')}</span>
                    </div>
                    <div className="ops-focus-speed">
                      {hasPosition ? (
                        <>
                          <strong style={{ color: speedChipColors(speed).color }}>{speed}</strong>
                          <span>km/h{speed > 80 ? ' · exceso' : ''}</span>
                        </>
                      ) : (
                        <span>{focusedBus.isPrivacyMode ? 'En privacidad' : 'Sin GPS'}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={showingRoute ? 'ops-button is-secondary' : 'ops-button'}
                      disabled={!hasNavRoute && !showingRoute}
                      onClick={() => handleToggleLiveRoute(focusedBus.placaAutobus)}
                    >
                      {showingRoute ? 'Ocultar recorrido' : (hasNavRoute ? 'Ver recorrido' : 'Sin destino fijado')}
                    </button>
                  </div>
                );
              })()}
            </section>
          </div>
        )}

      {/* VISTA DE GESTIÓN DE USUARIOS (Solo Administrador y SuperAdministrador) */}
      {activeTab === 'users' && (user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador') && (() => {
        const q = directoryQuery.trim().toLowerCase();
        const roleGroup = (rol: string) => rol === 'Piloto' ? 'pilots' : rol === 'Supervisor' ? 'supervisors' : 'admins';
        const counts = { all: users.length, pilots: 0, supervisors: 0, admins: 0 } as Record<string, number>;
        users.forEach((u) => { counts[roleGroup(u.tipoRol)] += 1; });
        const visible = users.filter((u) => (directoryFilter === 'all' || roleGroup(u.tipoRol) === directoryFilter)
          && (!q || u.nombreCompleto.toLowerCase().includes(q) || u.usuarioLogin.toLowerCase().includes(q)));
        const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
        return (
          <div className="screen directory-screen">
            <header className="screen-head">
              <div>
                <h1>Personal</h1>
                <p>{users.length} personas con acceso al sistema.</p>
              </div>
              <div className="screen-head-actions">
                <button type="button" className="pill-button is-highlight" onClick={openCreateModal}><Plus size={16} aria-hidden="true" /> Agregar persona</button>
              </div>
            </header>

            <div className="directory-tools">
              <label className="ops-search">
                <Search size={16} aria-hidden="true" />
                <input type="search" placeholder="Nombre o usuario" aria-label="Buscar personal" value={directoryQuery} onChange={(e) => setDirectoryQuery(e.target.value)} />
              </label>
              <div className="ops-segment is-inline" role="group" aria-label="Filtrar por perfil">
                {[['all', 'Todos'], ['pilots', 'Pilotos'], ['supervisors', 'Supervisores'], ['admins', 'Administración']].map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={directoryFilter === key} onClick={() => setDirectoryFilter(key)}>
                    {label} <span>{counts[key]}</span>
                  </button>
                ))}
              </div>
            </div>

            {crudError && <div role="alert" className="inline-error">{crudError}</div>}

            {loadingUsers ? (
              <p className="feed-empty">Cargando personal…</p>
            ) : visible.length === 0 ? (
              <p className="feed-empty">Nadie coincide con la búsqueda.</p>
            ) : (
              <ul className="dir-list" aria-label="Personal registrado">
                {visible.map((u) => (
                  <li key={u.idUsuario} className="dir-row person-row" data-inactive={u.estado !== 'Activo' || undefined}>
                    <span className="dir-avatar" aria-hidden="true">{initials(u.nombreCompleto)}</span>
                    <div className="dir-main">
                      <strong>{u.nombreCompleto}</strong>
                      <span>@{u.usuarioLogin}</span>
                    </div>
                    <span className={`role-chip is-${roleGroup(u.tipoRol)}`}>{u.tipoRol}</span>
                    <span className={`state-text ${u.estado === 'Activo' ? 'is-on' : 'is-off'}`}>{u.estado === 'Activo' ? 'Activo' : 'Sin acceso'}</span>
                    <div className="dir-actions">
                      <button type="button" className="pill-button is-ghost" onClick={() => openEditModal(u)}><Pencil size={14} aria-hidden="true" /> Editar</button>
                      <button type="button" className="pill-button is-ghost" onClick={() => handleToggleEstado(u)}>
                        {u.estado === 'Activo' ? <><UserRoundX size={14} aria-hidden="true" /> Quitar acceso</> : <><UserRoundCheck size={14} aria-hidden="true" /> Dar acceso</>}
                      </button>
                      {u.usuarioLogin !== 'superadmin' && u.usuarioLogin !== 'admin' ? (
                        <button type="button" className="icon-pill is-danger" aria-label={`Eliminar a ${u.nombreCompleto}`} title="Eliminar" onClick={() => handleDeleteUser(u)}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      ) : <span className="icon-pill is-placeholder" aria-hidden="true" />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      {/* MODAL / FORMULARIO FLOTANTE (GLASSMORPHISM) */}
      {showModal && (
        <Dialog
          kicker="Personal"
          icon={<Users size={20} />}
          title={editingUserId === null ? 'Agregar persona' : 'Editar persona'}
          description={editingUserId === null
            ? 'Crea el acceso para un piloto, supervisor o administrador.'
            : 'Actualiza sus datos. Deja la contraseña vacía para conservar la actual.'}
          onClose={() => setShowModal(false)}
          footer={(
            <>
              <button type="button" className="pill-button is-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
              <button type="submit" form="user-form" className="pill-button"><Save size={16} aria-hidden="true" /> Guardar</button>
            </>
          )}
        >
          {crudError && <div role="alert" className="auth-alert">{crudError}</div>}
          <form id="user-form" className="dlg-form" onSubmit={handleSaveUser}>
            <Field label="Nombre completo" htmlFor="user-name" wide>
              <input id="user-name" className="dlg-input" type="text" value={formNombre} onChange={(e) => setFormNombre(e.target.value)} required autoFocus placeholder="Ej. Juan Pérez" />
            </Field>
            <Field label="Usuario para entrar" htmlFor="user-login">
              <input id="user-login" className="dlg-input" type="text" value={formLogin} onChange={(e) => setFormLogin(e.target.value)} required autoComplete="off" placeholder="Ej. jperez" />
            </Field>
            <Field label="Rol">
              <AnimatedSelect aria-label="Rol del usuario" value={formRol} onChange={(e) => setFormRol(e.target.value as ManagedUser['tipoRol'])}>
                <option value="Piloto">Piloto</option>
                <option value="Administrador">Administrador</option>
                <option value="Supervisor">Supervisor</option>
              </AnimatedSelect>
            </Field>
            <Field
              label="Contraseña"
              htmlFor="user-password"
              hint={editingUserId !== null ? 'Déjala vacía para conservar la actual.' : 'Mínimo 12 caracteres.'}
            >
              <input
                id="user-password"
                className="dlg-input"
                type="password"
                value={formContrasena}
                onChange={(e) => setFormContrasena(e.target.value)}
                required={editingUserId === null}
                minLength={formContrasena ? 12 : undefined}
                maxLength={128}
                autoComplete="new-password"
                placeholder={editingUserId !== null ? '••••••••••••' : 'Nueva contraseña'}
              />
            </Field>
            <Field label="Estado">
              <AnimatedSelect aria-label="Estado del usuario" value={formEstado} onChange={(e) => setFormEstado(e.target.value as ManagedUser['estado'])}>
                <option value="Activo">Activo</option>
                <option value="Inactivo">Inactivo</option>
              </AnimatedSelect>
            </Field>
          </form>
        </Dialog>
      )}

      {activeTab === 'routes' && canMonitorOperations && (() => {
        const q = directoryQuery.trim().toLowerCase();
        const visible = routes.filter((r) => !q || [r.nombreRuta, r.origen, r.destino].some((v) => v?.toLowerCase().includes(q)));
        return (
          <div className="screen directory-screen">
            <header className="screen-head">
              <div>
                <h1>Rutas</h1>
                <p>Trayectos guardados para despachar más rápido.</p>
              </div>
              {canManageOperations && (
                <div className="screen-head-actions">
                  <button type="button" className="pill-button is-highlight" onClick={openCreateRouteModal}><Plus size={16} aria-hidden="true" /> Nueva ruta</button>
                </div>
              )}
            </header>

            <div className="directory-tools">
              <label className="ops-search">
                <Search size={16} aria-hidden="true" />
                <input type="search" placeholder="Nombre, origen o destino" aria-label="Buscar rutas" value={directoryQuery} onChange={(e) => setDirectoryQuery(e.target.value)} />
              </label>
            </div>

            {crudError && <div role="alert" className="inline-error">{crudError}</div>}

            {routes.length === 0 ? (
              <div className="feed-empty is-column">
                <MapPinned size={32} strokeWidth={1.5} aria-hidden="true" />
                <p><strong>Todavía no hay rutas guardadas.</strong></p>
                <p>Crea una aquí o deja que un piloto guarde su recorrido desde el mapa.</p>
              </div>
            ) : visible.length === 0 ? (
              <p className="feed-empty">Ninguna ruta coincide con la búsqueda.</p>
            ) : (
              <ul className="route-list" aria-label="Rutas guardadas">
                {visible.map((route) => {
                  const gpsReady = route.destinoLatitud != null && route.destinoLongitud != null;
                  return (
                    <li key={route.idRuta} className="route-row">
                      <div className="route-row-name">
                        <strong>{route.nombreRuta}</strong>
                        <span className={gpsReady ? 'is-ready' : ''}>{gpsReady ? 'Lista para navegación GPS' : 'Solo para despacho'}</span>
                      </div>
                      <div className="route-path" aria-label={`De ${route.origen} a ${route.destino}`}>
                        <span className="route-stop is-start">{route.origen}</span>
                        <span className="route-line" aria-hidden="true"><ArrowRight size={14} /></span>
                        <span className="route-stop is-end">{route.destino}</span>
                      </div>
                      {canManageOperations && (
                        <button type="button" className="pill-button is-ghost route-stops-button" onClick={() => setStopsRoute(route)}>
                          <MapPin size={14} aria-hidden="true" /> Paradas
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })()}

      {showRouteModal && (
        <Dialog
          kicker="Rutas"
          icon={<MapPin size={20} />}
          title={routeTripContext ? 'Guardar ruta del viaje' : 'Nueva ruta'}
          description={routeTripContext
            ? 'Nombra este recorrido. Quedará asociado al viaje y disponible para futuros despachos.'
            : 'Define un trayecto frecuente. Después podrás marcar sus paradas en el mapa.'}
          busy={routeSaving}
          onClose={() => { setShowRouteModal(false); setRouteTripContext(null); }}
          footer={(
            <>
              <button type="button" className="pill-button is-ghost" onClick={() => { setShowRouteModal(false); setRouteTripContext(null); }} disabled={routeSaving}>Cancelar</button>
              <button type="submit" form="route-form" className="pill-button" disabled={routeSaving}><Save size={16} aria-hidden="true" /> {routeSaving ? 'Guardando…' : 'Guardar ruta'}</button>
            </>
          )}
        >
          {crudError && <div role="alert" className="auth-alert">{crudError}</div>}
          <form id="route-form" className="dlg-form" onSubmit={handleSaveAdminRoute}>
            <Field label="Nombre de la ruta" htmlFor="route-name" wide>
              <input id="route-name" className="dlg-input" value={formRouteName} onChange={(event) => setFormRouteName(event.target.value)} minLength={2} maxLength={100} required autoFocus placeholder="Ej. Terminal - Centro" />
            </Field>
            <Field label="Origen" htmlFor="route-origin">
              <input id="route-origin" className="dlg-input" value={formRouteOrigin} onChange={(event) => setFormRouteOrigin(event.target.value)} minLength={2} maxLength={100} required placeholder="Ej. Terminal Minerva" />
            </Field>
            <Field label="Destino" htmlFor="route-destination">
              <input id="route-destination" className="dlg-input" value={formRouteDestination} onChange={(event) => setFormRouteDestination(event.target.value)} minLength={2} maxLength={100} required placeholder="Ej. Parque Central" />
            </Field>
          </form>
        </Dialog>
      )}

      {/* La supervisión puede consultar la flota; solo administración puede modificarla. */}
      {activeTab === 'buses' && canMonitorOperations && (() => {
        const q = directoryQuery.trim().toLowerCase();
        const withTrip = buses.map((b) => ({ bus: b, trip: trips.find(t => t.idAutobus === b.idAutobus && t.estadoViaje === 'En Curso') }));
        const stateOf = (entry: { bus: Autobus; trip?: Viaje }) => entry.bus.estado === 'En Taller' ? 'shop' : entry.bus.estado === 'Inactivo' ? 'off' : entry.trip ? 'road' : 'base';
        const counts: Record<string, number> = { all: withTrip.length, road: 0, base: 0, shop: 0, off: 0 };
        withTrip.forEach((e) => { counts[stateOf(e)] += 1; });
        const visible = withTrip.filter((e) => (directoryFilter === 'all' || stateOf(e) === directoryFilter)
          && (!q || e.bus.placa.toLowerCase().includes(q) || e.bus.marcaModelo?.toLowerCase().includes(q) || e.trip?.nombrePiloto?.toLowerCase().includes(q)));
        const stateLabel: Record<string, string> = { road: 'En ruta', base: 'En base', shop: 'En taller', off: 'Inactivo' };
        return (
          <div className="screen directory-screen">
            <header className="screen-head">
              <div>
                <h1>Autobuses</h1>
                <p>{counts.road} en ruta, {counts.base} en base{counts.shop ? `, ${counts.shop} en taller` : ''}.</p>
              </div>
              {canManageOperations && (
                <div className="screen-head-actions">
                  <button type="button" className="pill-button is-highlight" onClick={openCreateBusModal}><Plus size={16} aria-hidden="true" /> Agregar autobús</button>
                </div>
              )}
            </header>

            <div className="directory-tools">
              <label className="ops-search">
                <Search size={16} aria-hidden="true" />
                <input type="search" placeholder="Placa, modelo o piloto" aria-label="Buscar autobuses" value={directoryQuery} onChange={(e) => setDirectoryQuery(e.target.value)} />
              </label>
              <div className="ops-segment is-inline" role="group" aria-label="Filtrar por estado">
                {[['all', 'Todos'], ['road', 'En ruta'], ['base', 'En base'], ['shop', 'En taller']].map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={directoryFilter === key} onClick={() => setDirectoryFilter(key)}>
                    {label} <span>{counts[key]}</span>
                  </button>
                ))}
              </div>
            </div>

            {crudError && <div role="alert" className="inline-error">{crudError}</div>}

            {loadingBuses ? (
              <p className="feed-empty">Cargando autobuses…</p>
            ) : visible.length === 0 ? (
              <p className="feed-empty">Ningún autobús coincide.</p>
            ) : (
              <ul className="bus-board" aria-label="Flota registrada">
                {visible.map((entry) => {
                  const state = stateOf(entry);
                  return (
                    <li key={entry.bus.idAutobus} className="bus-tile" data-state={state}>
                      <div className="bus-tile-top">
                        <span className="plate">{entry.bus.placa}</span>
                        <span className={`bus-state is-${state}`}>{stateLabel[state]}</span>
                      </div>
                      <div className="bus-tile-body">
                        <span>{entry.bus.marcaModelo || 'Modelo sin registrar'}</span>
                        <strong>{entry.trip ? entry.trip.nombrePiloto : 'Sin piloto en ruta'}</strong>
                        {entry.trip?.nombreRuta && entry.trip.nombreRuta !== 'N/D' && <span>{entry.trip.nombreRuta}</span>}
                      </div>
                      {canManageOperations && (
                        <div className="bus-tile-actions">
                          <button type="button" className="pill-button is-ghost" onClick={() => openEditBusModal(entry.bus)}><Pencil size={14} aria-hidden="true" /> Editar</button>
                          <button type="button" className="pill-button is-ghost" onClick={() => setQrBus(entry.bus)}><QrCode size={14} aria-hidden="true" /> QR</button>
                          {entry.trip && (
                            <button type="button" className="pill-button is-ghost" onClick={() => { setFocusedBusPlaca(entry.bus.placa); setActiveTab('map'); }}>
                              <Navigation size={14} aria-hidden="true" /> Mapa
                            </button>
                          )}
                          <button type="button" className="icon-pill is-danger" aria-label={`Eliminar unidad ${entry.bus.placa}`} title="Eliminar" onClick={() => handleDeleteBus(entry.bus.idAutobus)}>
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })()}


      {showBusModal && (
        <Dialog
          kicker="Flota"
          icon={<Bus size={20} />}
          title={editingBusId === null ? 'Agregar autobús' : 'Editar autobús'}
          description={editingBusId === null
            ? 'Registra la unidad. Si eliges piloto, el viaje empieza al guardar.'
            : 'Cambia los datos de la unidad o, si lo necesitas, su operación actual.'}
          busy={busSaving}
          onClose={() => setShowBusModal(false)}
          footer={(
            <>
              <button type="button" className="pill-button is-ghost" onClick={() => setShowBusModal(false)} disabled={busSaving}>Cancelar</button>
              <button type="submit" form="bus-form" className="pill-button" disabled={busSaving}><Save size={16} aria-hidden="true" /> {busSaving ? 'Guardando…' : 'Guardar'}</button>
            </>
          )}
        >
          {crudError && <div role="alert" className="auth-alert">{crudError}</div>}
          <form id="bus-form" className="dlg-form" onSubmit={handleSaveBus}>
            <Field label="Placa" htmlFor="bus-plate">
              <input id="bus-plate" className="dlg-input" type="text" value={formPlaca} onChange={(e) => setFormPlaca(e.target.value)} required autoFocus placeholder="Ej. P-123ABC" />
            </Field>
            <Field label="Marca y modelo" htmlFor="bus-model">
              <input id="bus-model" className="dlg-input" type="text" value={formMarcaModelo} onChange={(e) => setFormMarcaModelo(e.target.value)} placeholder="Ej. Mercedes-Benz 2024" />
            </Field>
            <Field label="Estado" wide>
              <div className="dlg-segment" role="radiogroup" aria-label="Estado del autobús">
                {(['Activo', 'En Taller', 'Inactivo'] as Autobus['estado'][]).map((estado) => (
                  <button
                    key={estado}
                    type="button"
                    role="radio"
                    aria-checked={formEstadoBus === estado}
                    className={formEstadoBus === estado ? 'is-active' : ''}
                    onClick={() => setFormEstadoBus(estado)}
                  >
                    {estado}
                  </button>
                ))}
              </div>
            </Field>

            <div className="dlg-section is-wide">
              <div className="dlg-section-head">
                <div>
                  <strong>Operación</strong>
                  <span>Cambiar el piloto finaliza el viaje anterior de esta unidad.</span>
                </div>
                {editingBusId !== null && (
                  <label className="dlg-switch">
                    <input type="checkbox" checked={manageBusAssignment} onChange={(e) => setManageBusAssignment(e.target.checked)} />
                    <span aria-hidden="true" />
                    Modificar
                  </label>
                )}
              </div>
              <div className="dlg-form">
                <Field label="Piloto">
                  <AnimatedSelect
                    aria-label="Piloto asignado"
                    disabled={!manageBusAssignment}
                    value={formPilotoAsignado}
                    onChange={(e) => {
                      const pilotId = Number(e.target.value);
                      setFormPilotoAsignado(pilotId);
                      if (pilotId === 0) setFormRutaAsignadaBus(0);
                    }}
                  >
                    <option value={0}>Sin piloto (en base)</option>
                    {users.filter(u => u.tipoRol === 'Piloto').map(u => {
                      const activeAssignment = trips.find(
                        trip => trip.idUsuario === u.idUsuario && trip.estadoViaje === 'En Curso'
                      );
                      const assignedElsewhere = Boolean(
                        activeAssignment && activeAssignment.idAutobus !== editingBusId
                      );
                      const unavailable = u.estado !== 'Activo' || assignedElsewhere;
                      const availabilityLabel = u.estado !== 'Activo'
                        ? 'Inactivo'
                        : assignedElsewhere
                          ? `Asignado a ${activeAssignment?.placaAutobus ?? 'otra unidad'}`
                          : null;

                      return (
                        <option key={u.idUsuario} value={u.idUsuario} disabled={unavailable}>
                          {u.nombreCompleto} ({u.usuarioLogin})
                          {availabilityLabel ? ` — ${availabilityLabel}` : ''}
                        </option>
                      );
                    })}
                  </AnimatedSelect>
                </Field>
                <Field label="Ruta (opcional)">
                  <AnimatedSelect
                    aria-label="Ruta asignada"
                    value={formRutaAsignadaBus}
                    onChange={(e) => setFormRutaAsignadaBus(Number(e.target.value))}
                    disabled={!manageBusAssignment || formPilotoAsignado === 0}
                  >
                    <option value={0}>Sin ruta fija</option>
                    {routes.map(r => (
                      <option key={r.idRuta} value={r.idRuta}>
                        {r.nombreRuta} ({r.origen} a {r.destino})
                      </option>
                    ))}
                  </AnimatedSelect>
                </Field>
              </div>
            </div>
          </form>
        </Dialog>
      )}


      {/* Supervisión consulta los viajes; administración gestiona despachos. */}
      {activeTab === 'trips' && canMonitorOperations && (
        <div className="dashboard-view data-view" style={usersContainerStyle}>
          <div className="data-view-header" style={tableHeaderStyle}>
            <h2 style={cardTitleStyle}>Planificación de Viajes Diarios</h2>
            {canManageOperations && (
              <button className="button-with-icon" onClick={openCreateTripModal} style={addButtonStyle}>
                <Plus size={16} /> Registrar Despacho
              </button>
            )}
          </div>

          {crudError && (
            <div style={errorBannerStyle}>
               {crudError}
            </div>
          )}

          {loadingTrips ? (
            <div style={loadingTableStyle}>Cargando viajes programados de SQL Server...</div>
          ) : (
            <div className="responsive-table" style={tableWrapperStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Piloto</th>
                    <th style={thStyle}>Autobús (Placa)</th>
                    <th style={thStyle}>Ruta Asignada</th>
                    <th style={thStyle}>Hora Salida</th>
                    <th style={thStyle}>Hora Llegada</th>
                    <th style={thStyle}>Estado</th>
                    <th style={thStyle}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t) => (
                    <tr key={t.idViaje} style={trStyle}>
                      <td data-label="ID" style={tdStyle}>{t.idViaje}</td>
                      <td data-label="Piloto" style={tdStyle}>{t.nombrePiloto}</td>
                      <td data-label="Autobús" style={tdStyle}>{t.placaAutobus}</td>
                      <td data-label="Ruta" style={tdStyle}>{t.nombreRuta || 'N/D'}</td>
                      <td data-label="Salida" style={tdStyle}>{new Date(t.fechaInicio).toLocaleString()}</td>
                      <td data-label="Llegada" style={tdStyle}>
                        {t.fechaFin ? new Date(t.fechaFin).toLocaleString() : 'En Tránsito'}
                      </td>
                      <td data-label="Estado" style={tdStyle}>
                        <span style={statusBadgeStyle(t.estadoViaje)}>{t.estadoViaje}</span>
                      </td>
                      <td data-label="Acciones" style={tdStyle}>
                        {t.estadoViaje === 'En Curso' && canManageOperations ? (
                          <button onClick={() => handleFinalizeTrip(t.idViaje)} style={activateButtonStyle}>
                            Finalizar Viaje
                          </button>
                        ) : (
                          <span style={{ color: '#8b9bb4', fontSize: '0.85rem' }}>Ninguna</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VISTA DE HISTORIAL Y REPORTES DE ALERTAS (Administradores/Supervisores) */}
      {activeTab === 'alerts' && (user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador' || user?.tipoRol === 'Supervisor') && (
        (() => {
          const pageCount = Math.max(1, Math.ceil(historicalAlerts.length / alertsPageSize));
          const pageItems = historicalAlerts.slice((alertsPage - 1) * alertsPageSize, alertsPage * alertsPageSize);
          const byType = Object.entries(statAlertsByTipo).sort((a, b) => b[1] - a[1]);
          const maxType = Math.max(...byType.map(([, n]) => n), 1);
          const topPilots = statPilotosMasInfracciones.slice(0, 5);
          const maxPilot = topPilots[0]?.cantidadAlertas || 1;
          const severity = (tipo: string) => /velocidad/i.test(tipo) ? 'alert' : 'warn';
          const hasFilters = Boolean(filterFechaInicio || filterFechaFin || filterPiloto || filterTipoAlerta);

          return (
            <div className="screen alerts-screen">
              <header className="screen-head">
                <div>
                  <h1>Alertas</h1>
                  <p>Lo que pasó en la carretera y quién necesita atención.</p>
                </div>
                <div className="screen-head-actions">
                  <span className={`status-dot-pill ${wsConnected ? 'is-on' : 'is-off'}`}>
                    <Wifi size={14} aria-hidden="true" /> {wsConnected ? 'En vivo' : 'Sin conexión'}
                  </span>
                  <button type="button" className="pill-button is-ghost" disabled={exportingReport !== null} onClick={handleExportPdf}>
                    <FileDown size={15} aria-hidden="true" /> {exportingReport === 'pdf' ? 'Generando…' : 'PDF'}
                  </button>
                  <button type="button" className="pill-button is-ghost" disabled={exportingReport !== null} onClick={handleExportExcel}>
                    <Sheet size={15} aria-hidden="true" /> {exportingReport === 'excel' ? 'Generando…' : 'Excel'}
                  </button>
                </div>
              </header>

              <section className="big-stats" aria-label="Resumen">
                <div>
                  <span>Infracciones registradas</span>
                  <strong>{loadingStats ? '—' : Number(statTotalAlerts).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Evento más frecuente</span>
                  <strong className="is-text">{byType[0]?.[0] || 'Sin eventos'}</strong>
                </div>
                <div>
                  <span>Piloto con más eventos</span>
                  <strong className="is-text">{topPilots[0]?.nombrePiloto || 'Sin datos'}</strong>
                </div>
              </section>

              <div className="alerts-layout">
                <section className="alerts-feed" aria-label="Historial de alertas">
                  <form
                    className="filter-row"
                    onSubmit={(event) => { event.preventDefault(); setAlertsPage(1); void fetchHistoricalAlerts(); }}
                  >
                    <label className="filter-field">
                      <span>Desde</span>
                      <input type="date" value={filterFechaInicio} onChange={(e) => setFilterFechaInicio(e.target.value)} />
                    </label>
                    <label className="filter-field">
                      <span>Hasta</span>
                      <input type="date" value={filterFechaFin} onChange={(e) => setFilterFechaFin(e.target.value)} />
                    </label>
                    <div className="filter-field">
                      <span>Piloto</span>
                      <AnimatedSelect aria-label="Filtrar alertas por piloto" value={filterPiloto} onChange={(e) => setFilterPiloto(e.target.value)}>
                        <option value="">Todos</option>
                        {users.filter(u => u.tipoRol === 'Piloto').map(u => (
                          <option key={u.idUsuario} value={u.idUsuario}>{u.nombreCompleto}</option>
                        ))}
                      </AnimatedSelect>
                    </div>
                    <div className="filter-field">
                      <span>Tipo</span>
                      <AnimatedSelect aria-label="Filtrar por tipo de alerta" value={filterTipoAlerta} onChange={(e) => setFilterTipoAlerta(e.target.value)}>
                        <option value="">Todos</option>
                        <option value="Exceso de Velocidad">Exceso de velocidad</option>
                        <option value="Frenado Brusco">Frenado brusco</option>
                        <option value="Aceleración Peligrosa">Aceleración peligrosa</option>
                        <option value="Giro Brusco">Giro brusco</option>
                      </AnimatedSelect>
                    </div>
                    <div className="filter-buttons">
                      <button type="submit" className="pill-button">Aplicar</button>
                      {hasFilters && <button type="button" className="pill-button is-ghost" onClick={handleClearFilters}>Limpiar</button>}
                    </div>
                  </form>

                  {loadingHistorical ? (
                    <p className="feed-empty">Cargando alertas…</p>
                  ) : pageItems.length === 0 ? (
                    <p className="feed-empty"><CheckCircle2 size={20} aria-hidden="true" /> No hay alertas con estos filtros.</p>
                  ) : (
                    <ol className="alert-feed">
                      {pageItems.map((a) => {
                        const level = severity(a.tipoAlerta);
                        const when = new Date(a.fechaHora);
                        return (
                          <li key={a.idAlerta} className="alert-item" data-level={level}>
                            <span className="alert-item-icon" aria-hidden="true">
                              {level === 'alert' ? <Gauge size={18} /> : <AlertTriangle size={18} />}
                            </span>
                            <div className="alert-item-main">
                              <strong>{a.tipoAlerta}</strong>
                              <span>{a.nombrePiloto} · {a.placaAutobus}{a.nombreRuta ? ` · ${a.nombreRuta}` : ''}</span>
                            </div>
                            <div className="alert-item-value">
                              <strong>{a.valorRegistrado}</strong>
                              {a.limitePermitido != null && <span>límite {a.limitePermitido}</span>}
                            </div>
                            <time dateTime={a.fechaHora}>
                              <span>{when.toLocaleDateString([], { day: '2-digit', month: 'short' })}</span>
                              {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </time>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {historicalAlerts.length > 0 && (
                    <nav className="pager" aria-label="Páginas de alertas">
                      <span>
                        {(alertsPage - 1) * alertsPageSize + 1}–{Math.min(alertsPage * alertsPageSize, historicalAlerts.length)} de {historicalAlerts.length.toLocaleString()}
                      </span>
                      <div className="pager-controls">
                        <AnimatedSelect
                          aria-label="Alertas por página"
                          value={alertsPageSize}
                          onChange={(e) => { setAlertsPageSize(Number(e.target.value)); setAlertsPage(1); }}
                        >
                          <option value={10}>10 por página</option>
                          <option value={20}>20 por página</option>
                          <option value={50}>50 por página</option>
                        </AnimatedSelect>
                        <button type="button" className="pill-button is-ghost" disabled={alertsPage <= 1} onClick={() => setAlertsPage(p => Math.max(1, p - 1))}>Anterior</button>
                        <span className="pager-count">{alertsPage} / {pageCount}</span>
                        <button type="button" className="pill-button is-ghost" disabled={alertsPage >= pageCount} onClick={() => setAlertsPage(p => Math.min(pageCount, p + 1))}>Siguiente</button>
                      </div>
                    </nav>
                  )}
                </section>

                <aside className="alerts-side">
                  <section className="side-card">
                    <h2><Radio size={15} aria-hidden="true" /> Ahora mismo</h2>
                    {loadingAlerts ? (
                      <p className="side-empty">Consultando…</p>
                    ) : alerts.length === 0 ? (
                      <p className="side-empty">Sin incidencias recientes.</p>
                    ) : (
                      <ul className="mini-feed">
                        {alerts.slice(0, 5).map((a) => (
                          <li key={a.idAlerta} data-level={severity(a.tipoAlerta)}>
                            <div><strong>{a.tipoAlerta}</strong><span>{a.nombrePiloto} · {a.placaAutobus}</span></div>
                            <time>{new Date(a.fechaHora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="side-card">
                    <h2><BarChart3 size={15} aria-hidden="true" /> Por tipo</h2>
                    {byType.length === 0 ? <p className="side-empty">Sin datos.</p> : (
                      <ul className="bar-list">
                        {byType.map(([tipo, n]) => (
                          <li key={tipo}>
                            <div><span>{tipo}</span><strong>{n}</strong></div>
                            <i style={{ width: `${Math.round((n / maxType) * 100)}%` }} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="side-card">
                    <h2><Users size={15} aria-hidden="true" /> Pilotos con más eventos</h2>
                    {topPilots.length === 0 ? <p className="side-empty">Sin datos.</p> : (
                      <ul className="bar-list is-pilots">
                        {topPilots.map((p, idx) => (
                          <li key={`${p.nombrePiloto}-${idx}`}>
                            <div><span>{idx + 1}. {p.nombrePiloto}</span><strong>{p.cantidadAlertas}</strong></div>
                            <i style={{ width: `${Math.round((p.cantidadAlertas / maxPilot) * 100)}%` }} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </aside>
              </div>
            </div>
          );
        })()
      )}


      {showTripModal && (
        <Dialog
          kicker="Despacho"
          icon={<Navigation size={20} />}
          title="Iniciar un viaje"
          description="Solo aparecen pilotos y unidades activos que no están en ruta."
          onClose={() => setShowTripModal(false)}
          footer={(
            <>
              <button type="button" className="pill-button is-ghost" onClick={() => setShowTripModal(false)}>Cancelar</button>
              <button type="submit" form="trip-form" className="pill-button"><Navigation size={16} aria-hidden="true" /> Despachar</button>
            </>
          )}
        >
          <form id="trip-form" className="dlg-form" onSubmit={handleSaveTrip}>
            <Field label="Piloto">
              <AnimatedSelect aria-label="Piloto disponible" value={formTripPiloto} onChange={(e) => setFormTripPiloto(Number(e.target.value))} required>
                <option value="">Elige un piloto</option>
                {users
                  .filter(u => u.tipoRol === 'Piloto' && u.estado === 'Activo' && !trips.some(t => t.idUsuario === u.idUsuario && t.estadoViaje === 'En Curso'))
                  .map(u => (
                    <option key={u.idUsuario} value={u.idUsuario}>{u.nombreCompleto}</option>
                  ))}
              </AnimatedSelect>
            </Field>
            <Field label="Autobús">
              <AnimatedSelect aria-label="Autobús disponible" value={formTripBus} onChange={(e) => setFormTripBus(Number(e.target.value))} required>
                <option value="">Elige una unidad</option>
                {buses
                  .filter(b => b.estado === 'Activo' && !trips.some(t => t.idAutobus === b.idAutobus && t.estadoViaje === 'En Curso'))
                  .map(b => (
                    <option key={b.idAutobus} value={b.idAutobus}>{b.placa} ({b.marcaModelo || 'Sin marca'})</option>
                  ))}
              </AnimatedSelect>
            </Field>
            <Field label="Ruta (opcional)" wide>
              <AnimatedSelect aria-label="Ruta del viaje" value={formTripRoute} onChange={(e) => setFormTripRoute(Number(e.target.value))}>
                <option value={0}>Sin ruta fija</option>
                {routes.map(r => (
                  <option key={r.idRuta} value={r.idRuta}>{r.nombreRuta} ({r.origen} a {r.destino})</option>
                ))}
              </AnimatedSelect>
            </Field>
          </form>
        </Dialog>
      )}

      {/* VISTA DE ACTIVIDAD / HISTORIAL DE VIAJES (Inspirada en Uber Activity & Trip Details) */}
      {activeTab === 'activity' && (
        (() => {
          const isPilotUser = user?.tipoRol === 'Piloto';
          const canDispatchTrips = user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador';
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          oneWeekAgo.setHours(0, 0, 0, 0);
          const q = activitySearchQuery.trim().toLowerCase();
          const filtered = trips.filter((t) => {
            if (isPilotUser) {
              const matchId = t.idUsuario === user?.idUsuario;
              const matchName = t.nombrePiloto && user?.nombreCompleto
                && t.nombrePiloto.trim().toLowerCase() === user.nombreCompleto.trim().toLowerCase();
              if (!matchId && !matchName) return false;
            }
            const matchesSearch = q === ''
              || (t.nombreRuta && t.nombreRuta.toLowerCase().includes(q))
              || t.placaAutobus.toLowerCase().includes(q)
              || t.nombrePiloto.toLowerCase().includes(q);
            const matchesPilot = activityFilterPilot === '' || t.idUsuario === Number(activityFilterPilot);
            const matchesStatus = activityFilterStatus === '' || t.estadoViaje === activityFilterStatus;
            const matchesDate = activityFilterDate === '' || (t.fechaInicio && t.fechaInicio.startsWith(activityFilterDate));
            let matchesTimeRange = true;
            if (activityTimeRange === 'week' && !activityFilterDate) {
              const tripDate = new Date(t.fechaInicio);
              matchesTimeRange = !isNaN(tripDate.getTime()) && tripDate >= oneWeekAgo;
            }
            return matchesSearch && matchesPilot && matchesStatus && matchesDate && matchesTimeRange;
          });

          const dayLabel = (date: Date) => {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const day = new Date(date); day.setHours(0, 0, 0, 0);
            const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
            if (diff === 0) return 'Hoy';
            if (diff === 1) return 'Ayer';
            return date.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' });
          };
          const groups: { label: string; items: Viaje[] }[] = [];
          filtered.forEach((trip) => {
            const date = new Date(trip.fechaInicio);
            const label = isNaN(date.getTime()) ? 'Sin fecha' : dayLabel(date);
            const last = groups[groups.length - 1];
            if (last && last.label === label) last.items.push(trip);
            else groups.push({ label, items: [trip] });
          });
          const hasFilters = Boolean(activitySearchQuery || activityFilterPilot || activityFilterStatus || activityFilterDate);
          const openDetail = (trip: Viaje) => { setSelectedTripDetail(trip); setShowTripDetailModal(true); };

          return (
            <div className="screen trips-screen">
              <header className="screen-head">
                <div>
                  <h1>{isPilotUser ? 'Mis viajes' : 'Viajes'}</h1>
                  <p>{isPilotUser ? 'Tu viaje de hoy y los que ya hiciste.' : 'Cada salida de la flota, del despacho al cierre.'}</p>
                </div>
                <div className="screen-head-actions">
                  <div className="ops-segment is-inline" role="group" aria-label="Rango de fechas">
                    <button type="button" aria-pressed={activityTimeRange === 'week'} onClick={() => setActivityTimeRange('week')}>Última semana</button>
                    <button type="button" aria-pressed={activityTimeRange === 'all'} onClick={() => setActivityTimeRange('all')}>Todo</button>
                  </div>
                  {canDispatchTrips && (
                    <button type="button" className="pill-button is-highlight" onClick={openCreateTripModal}>
                      <Plus size={16} aria-hidden="true" /> Nuevo despacho
                    </button>
                  )}
                </div>
              </header>

              {isPilotUser && (
                loadingActiveTrip ? (
                  <section className="trip-hero is-muted"><p>Buscando tu viaje…</p></section>
                ) : activeTrip ? (
                  <section className="trip-hero" aria-label="Viaje en curso">
                    <div className="trip-hero-main">
                      <span>Viaje en curso</span>
                      <strong>{activeTrip.nombreRuta || 'Ruta libre'}</strong>
                      <p>Bus {activeTrip.placaAutobus} · salió {new Date(activeTrip.fechaInicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <button type="button" className="pill-button is-highlight" onClick={() => handleFinalizeTrip(activeTrip.idViaje)}>
                      <CheckCircle2 size={16} aria-hidden="true" /> Finalizar viaje
                    </button>
                  </section>
                ) : (
                  <section className="trip-hero is-muted">
                    <div className="trip-hero-main">
                      <span>Sin viaje asignado</span>
                      <p>Cuando tu supervisor te despache, aparecerá aquí.</p>
                    </div>
                  </section>
                )
              )}

              <form className="filter-row" onSubmit={(event) => event.preventDefault()}>
                <label className="filter-field is-wide">
                  <span>Buscar</span>
                  <input type="search" placeholder="Ruta, placa o piloto" value={activitySearchQuery} onChange={(e) => setActivitySearchQuery(e.target.value)} />
                </label>
                {!isPilotUser && (
                  <div className="filter-field">
                    <span>Piloto</span>
                    <AnimatedSelect aria-label="Filtrar viajes por piloto" value={activityFilterPilot} onChange={(e) => setActivityFilterPilot(e.target.value)}>
                      <option value="">Todos</option>
                      {users.filter(u => u.tipoRol === 'Piloto').map(u => (
                        <option key={u.idUsuario} value={u.idUsuario}>{u.nombreCompleto}</option>
                      ))}
                    </AnimatedSelect>
                  </div>
                )}
                <div className="filter-field">
                  <span>Estado</span>
                  <AnimatedSelect aria-label="Filtrar viajes por estado" value={activityFilterStatus} onChange={(e) => setActivityFilterStatus(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="En Curso">En curso</option>
                    <option value="Completado">Completado</option>
                    <option value="Cancelado">Cancelado</option>
                  </AnimatedSelect>
                </div>
                <label className="filter-field">
                  <span>Día</span>
                  <input type="date" value={activityFilterDate} onChange={(e) => setActivityFilterDate(e.target.value)} />
                </label>
                {hasFilters && (
                  <div className="filter-buttons">
                    <button type="button" className="pill-button is-ghost" onClick={() => {
                      setActivitySearchQuery(''); setActivityFilterPilot(''); setActivityFilterStatus(''); setActivityFilterDate('');
                    }}>Limpiar</button>
                  </div>
                )}
              </form>

              {loadingTrips ? (
                <p className="feed-empty">Cargando viajes…</p>
              ) : groups.length === 0 ? (
                <div className="feed-empty is-column">
                  <p>{activityTimeRange === 'week' ? 'No hay viajes en los últimos 7 días con estos filtros.' : 'No hay viajes con estos filtros.'}</p>
                  {activityTimeRange === 'week' && (
                    <button type="button" className="pill-button is-ghost" onClick={() => setActivityTimeRange('all')}>Ver todo el historial</button>
                  )}
                </div>
              ) : (
                <div className="trip-timeline">
                  {groups.map((group) => (
                    <section key={group.label} className="trip-day">
                      <h2>{group.label}</h2>
                      <ol>
                        {group.items.map((trip) => {
                          const status = trip.estadoViaje === 'En Curso' ? 'live' : trip.estadoViaje === 'Cancelado' ? 'cancelled' : 'done';
                          const date = new Date(trip.fechaInicio);
                          const routeName = trip.nombreRuta && trip.nombreRuta !== 'N/D' ? trip.nombreRuta : (trip.destinoNombre || 'Ruta sin guardar');
                          return (
                            <li key={trip.idViaje} className="trip-row" data-status={status}>
                              <time dateTime={trip.fechaInicio}>
                                {isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </time>
                              <span className="trip-row-dot" aria-hidden="true" />
                              <button type="button" className="trip-row-main" onClick={() => openDetail(trip)} aria-label={`Ver detalle del viaje ${routeName}`}>
                                <strong>{routeName}</strong>
                                <span>{trip.placaAutobus}{isPilotUser ? '' : ` · ${trip.nombrePiloto}`}</span>
                              </button>
                              <span className={`trip-status is-${status}`}>
                                {status === 'live' ? <Radio size={13} aria-hidden="true" /> : status === 'cancelled' ? <AlertTriangle size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
                                {status === 'live' ? 'En curso' : status === 'cancelled' ? 'Cancelado' : 'Completado'}
                              </span>
                              {status === 'live' && !isPilotUser && (
                                <button
                                  type="button"
                                  className="pill-button is-ghost trip-row-map"
                                  onClick={() => {
                                    setActiveLiveRoutePlaca(trip.placaAutobus);
                                    setFocusedBusPlaca(trip.placaAutobus);
                                    setActiveTab('map');
                                  }}
                                >
                                  <Navigation size={14} aria-hidden="true" /> Ver en mapa
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  ))}
                  {activityTimeRange === 'week' && (
                    <button type="button" className="pill-button is-ghost trip-more" onClick={() => setActivityTimeRange('all')}>
                      Ver todo el historial <ChevronDown size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })()
      )}

      {showTripDetailModal && selectedTripDetail && (() => {
        const detail = selectedTripDetail;
        const tripAlerts = historicalAlerts.filter(a => a.idViaje === detail.idViaje);
        const started = new Date(detail.fechaInicio);
        const inProgress = detail.estadoViaje === 'En Curso';
        const closeDetail = () => setShowTripDetailModal(false);
        return (
          <Dialog
            kicker={`Viaje #${detail.idViaje}`}
            icon={<Bus size={20} />}
            title={`Viaje con ${detail.nombrePiloto}`}
            description={`${started.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })} · ${started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Unidad ${detail.placaAutobus}`}
            onClose={closeDetail}
            footer={(
              <>
                {canManageOperations && !detail.idRuta && detail.destinoLatitud != null && detail.destinoLongitud != null && (
                  <button type="button" className="pill-button is-ghost dlg-foot-start" onClick={() => openSaveTripAsRouteModal(detail)}>
                    <BookmarkPlus size={16} aria-hidden="true" /> Guardar como ruta
                  </button>
                )}
                <button type="button" className="pill-button is-ghost" onClick={closeDetail}>Cerrar</button>
                <button
                  type="button"
                  className="pill-button"
                  onClick={() => {
                    closeDetail();
                    setActiveLiveRoutePlaca(detail.placaAutobus);
                    setFocusedBusPlaca(detail.placaAutobus);
                    setActiveTab('map');
                  }}
                >
                  <Navigation size={16} aria-hidden="true" /> Ver en el mapa
                </button>
              </>
            )}
          >
            <div className="dlg-chips">
              <span className={`dlg-chip${inProgress ? ' is-live' : ''}`}>{inProgress ? 'En ruta' : detail.estadoViaje}</span>
              <span className={`dlg-chip${tripAlerts.length ? ' is-danger' : ' is-ok'}`}>
                {tripAlerts.length ? `${tripAlerts.length} ${tripAlerts.length === 1 ? 'alerta' : 'alertas'}` : 'Conducción segura'}
              </span>
            </div>

            <ol className="dlg-timeline">
              <li>
                <span className="dlg-dot" aria-hidden="true" />
                <div>
                  <strong>{detail.origenRuta || 'Punto de salida'}</strong>
                  <span>Salida · {started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </li>
              <li>
                <span className="dlg-dot is-end" aria-hidden="true" />
                <div>
                  <strong>{detail.destinoRuta || detail.destinoNombre || 'Destino por confirmar'}</strong>
                  <span>{detail.fechaFin
                    ? `Llegada · ${new Date(detail.fechaFin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'En camino'}</span>
                </div>
              </li>
            </ol>

            {canManageOperations && inProgress && (
              <section className="dlg-section">
                <div className="dlg-section-head">
                  <div>
                    <strong>Enlace para pasajeros</strong>
                    <span>Compartir reutiliza el enlace vigente. Rotarlo invalida el anterior.</span>
                  </div>
                  <button type="button" className="pill-button is-ghost is-small" onClick={() => void createPublicTripLink(detail, true)} disabled={creatingPublicLink}>
                    <RefreshCw size={14} aria-hidden="true" /> Rotar
                  </button>
                </div>
                {!publicTripLink ? (
                  <button type="button" className="pill-button is-ghost" onClick={() => void createPublicTripLink(detail)} disabled={creatingPublicLink}>
                    <QrCode size={16} aria-hidden="true" /> {creatingPublicLink ? 'Generando…' : 'Generar enlace y QR'}
                  </button>
                ) : (
                  <div className="dlg-share">
                    {publicTripQr && <img src={publicTripQr} alt="Código QR del viaje" />}
                    <div>
                      <input aria-label="Enlace público del viaje" className="dlg-input" readOnly value={publicTripLink} onFocus={(event) => event.currentTarget.select()} />
                      <div className="dlg-share-actions">
                        <button type="button" className="pill-button is-ghost is-small" onClick={() => void copyPublicTripLink()}><Copy size={14} aria-hidden="true" /> Copiar</button>
                        <button type="button" className="pill-button is-ghost is-small" onClick={() => window.open(publicTripLink, '_blank', 'noopener,noreferrer')}><ExternalLink size={14} aria-hidden="true" /> Abrir</button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className="dlg-section">
              <div className="dlg-section-head">
                <div>
                  <strong>Seguridad</strong>
                  <span>{tripAlerts.length
                    ? 'Eventos registrados durante este recorrido.'
                    : 'Sin excesos de velocidad ni maniobras bruscas en este recorrido.'}</span>
                </div>
              </div>
              {tripAlerts.length > 0 && (
                <ul className="dlg-alerts">
                  {tripAlerts.map((alt) => (
                    <li key={alt.idAlerta}>
                      <strong>{alt.tipoAlerta}</strong>
                      <span>{alt.valorRegistrado}</span>
                      <time>{new Date(alt.fechaHora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Dialog>
        );
      })()}

      {/* VISTA DE CHAT OPERATIVO EN TIEMPO REAL - CANAL GENERAL Y PRIVADO */}
      {activeTab === 'chat' && (
        <div className="dashboard-view chat-view">
          {/* Panel Izquierdo: Selector de Canales (General vs Privados) */}
          <div className="chat-channel-panel" style={{
            width: '320px',
            backgroundColor: 'var(--surface)',
            borderRadius: '14px',
            border: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
            boxShadow: 'var(--shadow-card)'
          }}>
            {/* Selector de Modo */}
            <div style={{ padding: '14px', borderBottom: '1px solid var(--line)', backgroundColor: 'var(--surface-soft)' }}>
              <div style={{
                display: 'flex',
                backgroundColor: 'var(--surface)',
                padding: '3px',
                borderRadius: '10px',
                border: '1px solid var(--line)',
                gap: '3px'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setChatMode('general');
                  }}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: chatMode === 'general' ? 'var(--accent)' : 'transparent',
                    color: chatMode === 'general' ? 'var(--on-accent)' : 'var(--muted)',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: chatMode === 'general' ? '0 7px 18px var(--accent-shadow)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <Radio size={14} />
                  <span>General</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChatMode('private');
                    const pilotUsers = users.filter(u => u.tipoRol === 'Piloto');
                    if (pilotUsers.length > 0) {
                      const p = selectedChatPilotId && pilotUsers.some(x => x.idUsuario === selectedChatPilotId)
                        ? pilotUsers.find(x => x.idUsuario === selectedChatPilotId)!
                        : pilotUsers[0];
                      setSelectedChatPilotId(p.idUsuario);
                      setSelectedChatPilotName(p.nombreCompleto);
                    } else if (user?.tipoRol !== 'Piloto') {
                      fetchUsers();
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: chatMode === 'private' ? 'var(--accent)' : 'transparent',
                    color: chatMode === 'private' ? 'var(--on-accent)' : 'var(--muted)',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: chatMode === 'private' ? '0 7px 18px var(--accent-shadow)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <Users size={14} />
                  <span>Privado</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPassengerInbox(true)}
                  style={{
                    flex: 1,
                    padding: '7px 8px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: 'var(--muted)',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <MessageCircle size={14} />
                  <span>Pasajeros</span>
                </button>
              </div>
            </div>

            {/* Contenido del Panel Izquierdo según Modo */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {chatMode === 'general' ? (
                <>
                  <div style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--accent-soft)',
                    border: '1px solid var(--accent-line)'
                  }}>
                    <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Radio size={14} /> Canal de Radio General
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.74rem', marginTop: '2px' }}>Toda la Flota Sincronizada</div>
                  </div>

                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '8px' }}>
                    Pilotos en Turno ({users.filter(u => u.tipoRol === 'Piloto').length})
                  </div>
                  {users.filter(u => u.tipoRol === 'Piloto').length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '14px', color: 'var(--subtle)', fontSize: '0.78rem' }}>
                      Cargando conductores...
                    </div>
                  ) : (
                    users.filter(u => u.tipoRol === 'Piloto').map((pilot) => (
                      <div
                        key={pilot.idUsuario}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '12px',
                          backgroundColor: 'var(--surface-soft)',
                          border: `1px solid ${'var(--line)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '10px',
                          backgroundColor: 'var(--surface-soft)',
                          border: `1px solid ${'var(--line)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          color: 'var(--accent)',
                          flexShrink: 0
                        }}>
                          {pilot.nombreCompleto?.charAt(0) || 'P'}
                        </div>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <div style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '0.84rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {pilot.nombreCompleto} {pilot.idUsuario === user?.idUsuario && ' (Tú)'}
                          </div>
                          <div style={{ color: pilot.estado === 'Activo' ? ('var(--success)') : ('var(--subtle)'), fontSize: '0.72rem', marginTop: '1px', fontWeight: 500 }}>
                            <span className={`presence-label ${pilot.estado === 'Activo' ? 'is-online' : ''}`}><span className="presence-dot" />{pilot.estado === 'Activo' ? 'En línea' : 'Desconectado'}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </>
              ) : (
                /* Modo Privado */
                <>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {user?.tipoRol === 'Piloto' ? 'Canal con Despacho' : 'Seleccionar Piloto'}
                  </div>

                  {user?.tipoRol === 'Piloto' ? (
                    <div style={{
                      padding: '12px 14px',
                      borderRadius: '12px',
                      backgroundColor: 'var(--accent-soft)',
                      border: '1px solid var(--accent-line)'
                    }}>
                      <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <MessageSquare size={14} /> Centro de Despacho
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.74rem', marginTop: '2px' }}>Línea Confidencial Directa</div>
                    </div>
                  ) : (
                    loadingUsers ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--subtle)', fontSize: '0.8rem' }}>
                        Cargando pilotos...
                      </div>
                    ) : users.filter(u => u.tipoRol === 'Piloto').length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--subtle)', fontSize: '0.8rem' }}>
                        <div>No se encontraron pilotos registrados.</div>
                        <button
                          type="button"
                          onClick={() => fetchUsers()}
                          style={{
                            marginTop: '10px',
                            backgroundColor: 'var(--surface)',
                            color: 'var(--accent)',
                            border: `1.5px solid ${'var(--line)'}`,
                            padding: '6px 12px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}
                        >
                          Recargar Pilotos
                        </button>
                      </div>
                    ) : (
                      users.filter(u => u.tipoRol === 'Piloto').map((pilot) => {
                        const isActive = selectedChatPilotId === pilot.idUsuario;
                        return (
                          <button
                            key={pilot.idUsuario}
                            type="button"
                            onClick={() => {
                              setSelectedChatPilotId(pilot.idUsuario);
                              setSelectedChatPilotName(pilot.nombreCompleto);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '12px',
                              backgroundColor: isActive ? 'var(--accent-soft)' : ('var(--surface)'),
                              border: `1px solid ${isActive ? 'var(--accent-line)' : ('var(--line)')}`,
                              color: 'var(--ink)',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                              transition: 'all 0.15s ease',
                              boxShadow: isActive ? '0 7px 18px var(--accent-shadow)' : 'none'
                            }}
                          >
                            <div style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '10px',
                              backgroundColor: isActive ? 'var(--accent-soft)' : ('var(--surface-soft)'),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '0.82rem',
                              color: 'var(--accent)',
                              flexShrink: 0
                            }}>
                              {pilot.nombreCompleto?.charAt(0) || 'P'}
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {pilot.nombreCompleto}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: pilot.estado === 'Activo' ? ('var(--success)') : ('var(--subtle)'), marginTop: '1px', fontWeight: 500 }}>
                                <span className={`presence-label ${pilot.estado === 'Activo' ? 'is-online' : ''}`}><span className="presence-dot" />{pilot.estado === 'Activo' ? 'Operativo' : 'Desconectado'}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )
                  )}
                </>
              )}
            </div>
          </div>

          {/* Panel Principal: Conversación */}
          <div className="chat-conversation-panel" style={{
            flex: 1,
            backgroundColor: 'var(--surface)',
            borderRadius: '14px',
            border: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-card)'
          }}>
            {/* Header de Conversación */}
            <div className="chat-conversation-header" style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--surface)'
            }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                  <span>
                    {chatMode === 'general'
                      ? 'Toda la flota'
                      : (user?.tipoRol === 'Piloto' ? 'Despacho' : selectedChatPilotName)}
                  </span>
                </h3>
                <p style={{ margin: '2px 0 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
                  {chatMode === 'general'
                    ? 'Lo ven todos los pilotos y la administración.'
                    : (user?.tipoRol === 'Piloto' ? 'Solo tú, despacho y supervisión.' : 'Solo este piloto, despacho y supervisión.')}
                </p>
              </div>

              <div className="chat-conversation-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {(user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador') && chatMessages.length > 0 && (
                  <button
                    onClick={handleClearChatChannel}
                    style={{
                      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2',
                      border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.3)' : '#fecaca'}`,
                      borderRadius: '8px',
                      color: '#ef4444',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: '5px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Trash2 size={13} />
                    <span>Vaciar Chat</span>
                  </button>
                )}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'var(--accent-soft)',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-line)',
                  color: 'var(--accent)',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  gap: '6px'
                }}>
                  <Radio size={12} />
                  <span>{chatMode === 'general' ? 'CANAL GENERAL' : 'CANAL PRIVADO'}</span>
                </div>
              </div>
            </div>

            {/* Hilo de Mensajes */}
            <div
              className="chat-messages"
              ref={chatMessagesContainerRef}
              onScroll={handleChatScroll}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '20px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                backgroundColor: 'var(--canvas)'
              }}
            >
              {chatLoading ? (
                <div style={{ margin: 'auto', color: 'var(--muted)', fontSize: '0.88rem' }}>Cargando mensajes...</div>
              ) : chatMessages.length === 0 ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem' }}>
                  No hay mensajes en esta conversación.
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isMine = msg.idEmisor === user?.idUsuario;
                  const isAdmin = msg.rolEmisor === 'Administrador' || msg.rolEmisor === 'SuperAdministrador' || msg.rolEmisor === 'Supervisor';
                  const isCurrentViewerAdmin = user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador';
                  const isExpanded = !!expandedMessageTimestamps[msg.idMensaje];
                  const dateStr = msg.fechaHora ? new Date(msg.fechaHora).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
                  const timeStr = msg.fechaHora ? new Date(msg.fechaHora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
                  const shortTimeStr = msg.fechaHora ? new Date(msg.fechaHora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  const senderVisual = getChatSenderVisual(msg.idEmisor, msg.nombreEmisor);
                  return (
                    <div
                      key={msg.idMensaje}
                      style={{
                        display: 'flex',
                        justifyContent: isMine ? 'flex-end' : 'flex-start',
                        alignItems: 'flex-end',
                        gap: '9px',
                        width: '100%'
                      }}
                    >
                      {!isMine && (
                        <div
                          aria-label={`Mensaje de ${msg.nombreEmisor}`}
                          title={msg.nombreEmisor}
                          style={{
                            width: '34px',
                            height: '34px',
                            borderRadius: '999px',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: senderVisual.accent,
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 900,
                            letterSpacing: '0.02em',
                            boxShadow: `0 0 0 3px ${'var(--canvas)'}`
                          }}
                        >
                          {getChatInitials(msg.nombreEmisor)}
                        </div>
                      )}
                      <div
                        className="chat-message-bubble"
                        onClick={() => toggleMessageTimestamp(msg.idMensaje)}
                        onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                        title={isCurrentViewerAdmin ? "Click para ver fecha/hora • Click derecho para eliminar" : "Click para ver fecha/hora"}
                        style={{
                          maxWidth: '72%',
                          backgroundColor: isMine ? 'var(--accent)' : 'var(--surface)',
                          border: `1px solid ${isMine ? 'var(--accent)' : 'var(--line)'}`,
                          borderRadius: '18px',
                          borderBottomRightRadius: isMine ? '6px' : '18px',
                          borderBottomLeftRadius: isMine ? '18px' : '6px',
                          padding: '10px 16px',
                          color: isMine ? 'var(--on-accent)' : ('var(--ink)'),
                          cursor: 'pointer',
                          userSelect: 'none',
                          position: 'relative',
                          boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.03)'
                        }}
                      >
                        {!isMine && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: isDark ? '#0b0f19aa' : '#ffffffaa',
                              border: `1px solid ${senderVisual.accent}55`,
                              color: senderVisual.accent
                            }}>
                              {isAdmin ? 'ADMIN' : 'PILOTO'}
                            </span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: senderVisual.accent }}>
                              {msg.nombreEmisor}
                            </span>
                          </div>
                        )}
                        <div style={{ fontSize: '0.9rem', lineHeight: '1.45', wordBreak: 'break-word', color: isMine ? 'var(--on-accent)' : ('var(--ink)') }}>
                          {msg.contenido}
                        </div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          gap: '5px',
                          marginTop: '5px',
                          color: isMine ? 'rgba(255,255,255,0.76)' : ('var(--muted)'),
                          fontSize: '0.68rem',
                          fontWeight: 600
                        }}>
                          {isMine && <span>Tú</span>}
                          {isMine && <span>·</span>}
                          <span>{shortTimeStr}</span>
                        </div>
                        {isExpanded && (
                          <div style={{
                            fontSize: '0.72rem',
                            color: isMine ? 'rgba(255,255,255,0.86)' : ('var(--muted)'),
                            marginTop: '6px',
                            paddingTop: '6px',
                            borderTop: `1px solid ${isMine ? 'rgba(255,255,255,0.3)' : `${senderVisual.accent}44`}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '12px'
                          }}>
                            <span>{dateStr}</span>
                            <span style={{ fontWeight: 600 }}>{timeStr}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Chips de Respuestas Rápidas */}
            <div className="chat-quick-replies" style={{
              padding: '10px 24px',
              backgroundColor: 'var(--surface)',
              borderTop: `1px solid ${'var(--surface-soft)'}`,
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
              flexShrink: 0
            }}>
              {(chatMode === 'general'
                ? (user?.tipoRol === 'Piloto'
                    ? [
                        { label: 'Tráfico denso', text: 'Aviso de Piloto: Tráfico pesado en el tramo actual, avance lento.' },
                        { label: 'Parada momentánea', text: 'Aviso de Piloto: Realizando parada breve por tráfico/pasajeros.' },
                        { label: 'Falla mecánica', text: 'Precaución: Revisión técnica preventiva en curso en mi unidad.' },
                        { label: 'En ruta sin novedades', text: 'Reporte: En ruta normal y cumpliendo itinerario.' }
                      ]
                    : [
                        { label: 'Aviso General', text: 'Atención a todos los pilotos: Mantener velocidad moderada y precaución.' },
                        { label: 'Alerta Lluvia', text: 'Alerta Meteorológica: Reporte de lluvia en ruta, aumenten distancia de frenado.' },
                        { label: 'Desvío de Flota', text: 'Indicación General: Hay desvíos por trabajos en la vía principal.' },
                        { label: 'Enterado y recibido', text: 'Enterado del reporte de la flota. Buen turno y precaución.' }
                      ]
                  )
                : (user?.tipoRol === 'Piloto'
                    ? [
                        { label: 'Consulta Directa', text: 'Buenos días central, solicito información sobre el siguiente horario de salida.' },
                        { label: 'Reporte Privado', text: 'Central, me detengo momentáneamente por inconveniente menor en la unidad.' },
                        { label: 'Turno Iniciado', text: 'Iniciando recorrido asignado con unidad en perfecto estado.' }
                      ]
                    : [
                        { label: 'Moderar Velocidad', text: 'Favor de reducir la velocidad en el siguiente tramo por seguridad vial.' },
                        { label: 'Nueva Indicación', text: 'Te asignamos un ajuste temporal de parada en la siguiente estación.' },
                        { label: 'Recibido Directo', text: 'Recibido y registrado en la bitácora de despacho.' }
                      ]
                  )
              ).map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendChatMessage(chip.text, 'alerta')}
                  disabled={user?.tipoRol === 'Supervisor'}
                  style={{
                    backgroundColor: 'var(--surface-soft)',
                    color: 'var(--muted)',
                    border: `1.5px solid ${'var(--line)'}`,
                    borderRadius: '10px',
                    padding: '6px 14px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: user?.tipoRol === 'Supervisor' ? 'not-allowed' : 'pointer',
                    opacity: user?.tipoRol === 'Supervisor' ? 0.48 : 1,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f1f5f9';
                    e.currentTarget.style.color = 'var(--ink)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--surface-soft)';
                    e.currentTarget.style.color = 'var(--muted)';
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Formulario de Envío de Mensaje */}
            <form
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendChatMessage();
              }}
              style={{
                padding: '16px 24px',
                borderTop: `1px solid ${'var(--surface-soft)'}`,
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                backgroundColor: 'var(--surface)',
                flexShrink: 0
              }}
            >
              <input
                type="text"
                placeholder={user?.tipoRol === 'Supervisor' ? 'Canal disponible en modo auditoría' : chatMode === 'general' ? 'Escribe un mensaje al canal general de la flota...' : 'Visible para el piloto, administración y supervisión...'}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={user?.tipoRol === 'Supervisor'}
                style={{
                  ...formInputStyle,
                  backgroundColor: 'var(--surface-soft)',
                  borderColor: 'var(--line)',
                  color: 'var(--ink)',
                  padding: '12px 18px',
                  borderRadius: '14px',
                  fontSize: '0.9rem',
                  fontWeight: 500
                }}
              />
              <button
                type="submit"
                disabled={user?.tipoRol === 'Supervisor' || !chatInput.trim() || chatSending}
                style={{
                  ...saveButtonStyle,
                  backgroundColor: user?.tipoRol !== 'Supervisor' && chatInput.trim() && !chatSending ? 'var(--accent)' : ('var(--line-strong)'),
                  padding: '12px 22px',
                  borderRadius: '14px',
                  opacity: user?.tipoRol !== 'Supervisor' && chatInput.trim() && !chatSending ? 1 : 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  boxShadow: user?.tipoRol !== 'Supervisor' && chatInput.trim() && !chatSending ? '0 7px 18px var(--accent-shadow)' : 'none'
                }}
              >
                <Send size={15} />
                <span>{chatSending ? 'Enviando...' : 'Enviar'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {qrBus && <BusQrModal idAutobus={qrBus.idAutobus} placa={qrBus.placa} onClose={() => setQrBus(null)} />}
      {stopsRoute && (
        <RouteStopsModal
          route={stopsRoute}
          onClose={() => setStopsRoute(null)}
          onSaved={(count) => { setStopsRoute(null); notify(count ? `Ruta con ${count} paradas guardada.` : 'La ruta quedó sin paradas.', 'success'); }}
        />
      )}
      {showPassengerInbox && <PassengerInbox readOnly={user?.tipoRol === 'Supervisor'} onClose={() => setShowPassengerInbox(false)} />}

      {/* Menú Contextual Flotante de Click Derecho en Mensajes */}
      {chatContextMenu && chatContextMenu.visible && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(chatContextMenu.y, window.innerHeight - 90),
            left: Math.min(chatContextMenu.x, window.innerWidth - 180),
            backgroundColor: 'var(--surface)',
            border: `1px solid ${'var(--line)'}`,
            borderRadius: '12px',
            padding: '4px',
            boxShadow: isDark ? '0 12px 30px rgba(0, 0, 0, 0.6)' : '0 12px 30px rgba(0, 0, 0, 0.12)',
            zIndex: 99999,
            minWidth: '160px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          <button
            onClick={() => {
              const id = chatContextMenu.idMensaje;
              setChatContextMenu(null);
              toggleMessageTimestamp(id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--ink)',
              padding: '8px 12px',
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '0.82rem',
              fontWeight: 600,
              width: '100%',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-soft)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            Ver Fecha y Hora
          </button>
          {(user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador') && (
            <button
              onClick={() => {
                const id = chatContextMenu.idMensaje;
                setChatContextMenu(null);
                handleDeleteChatMessage(id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: 'transparent',
                border: 'none',
                color: '#ef4444',
                padding: '8px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '0.82rem',
                fontWeight: 600,
                width: '100%',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              Eliminar Mensaje
            </button>
          )}
        </div>
      )}

      <ToastViewport notifications={notifications} onDismiss={dismissNotification} />
      <ConfirmationDialog
        confirmation={customConfirm}
        onClose={closeCustomConfirm}
      />
      </main>
    </div>
  );
};

// --- Generador de Estilos de Dashboard Dinámicos para Modo Claro y Oscuro ---
