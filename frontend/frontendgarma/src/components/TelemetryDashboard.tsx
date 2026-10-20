import React, { useState, useEffect, useRef, useCallback } from 'react';
import { isAxiosError } from 'axios';
import { useAuth } from '../context/useAuth';
import api, { buildWebSocketUrl } from '../services/api';
import { GoogleMapWeb } from './GoogleMapWeb';
import { ConfirmationDialog } from './ConfirmationDialog';
import type { ConfirmationState } from './ConfirmationDialog';
import { AnimatedSelect } from './AnimatedSelect';
import { ToastViewport } from './ToastViewport';
import type { ToastNotification, ToastTone } from './ToastViewport';
import { DashboardHeader } from './DashboardHeader';
import { DashboardSidebar } from './DashboardSidebar';
import { PilotTrackingBar } from './PilotTrackingBar';
import { PassengerInbox } from './PassengerInbox';
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
  X,
  FileDown,
  Sheet,
  ChevronDown,
  Activity,
  Gauge,
  ShieldAlert,
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

const isTelemetryFresh = (bus: LiveTelemetryData, now: number) => (
  !bus.isOffline && Boolean(bus.lastObservedAt && now - bus.lastObservedAt < 30000 && bus.lastObservedAt <= now + 5000)
);

const CHAT_SENDER_PALETTE = [
  { accent: '#2563eb', light: '#eff6ff', dark: 'rgba(37, 99, 235, 0.18)' },
  { accent: '#7c3aed', light: '#f5f3ff', dark: 'rgba(124, 58, 237, 0.18)' },
  { accent: '#059669', light: '#ecfdf5', dark: 'rgba(5, 150, 105, 0.18)' },
  { accent: '#db2777', light: '#fdf2f8', dark: 'rgba(219, 39, 119, 0.18)' },
  { accent: '#b45309', light: '#fffbeb', dark: 'rgba(180, 83, 9, 0.2)' },
  { accent: '#0891b2', light: '#ecfeff', dark: 'rgba(8, 145, 178, 0.18)' },
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
    const timer = window.setInterval(() => setFreshnessTimestamp(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Generación de estilos dinámicos para modo claro/oscuro
  const {
    containerStyle,
    mainContentWrapperStyle,
    cardStyle,
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
    actionGroupStyle,
    editButtonStyle,
    deactivateButtonStyle,
    deleteButtonStyle,
    activateButtonStyle,
    statusBadgeStyle,
    errorBannerStyle,
    modalOverlayStyle,
    modalCardStyle,
    modalTitleStyle,
    formGroupStyle,
    formLabelStyle,
    formInputStyle,
    modalActionsStyle,
    cancelButtonStyle,
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
  const [trackingTabFilter, setTrackingTabFilter] = useState<'active' | 'all'>('active');
  const [focusedBusPlaca, setFocusedBusPlaca] = useState<string | null>(null);

  // Estados para Navegación del Panel
  const [activeTab, setActiveTab] = useState<DashboardTab>('map');

  // Estados para el Módulo de Chat en Tiempo Real (General & Privado)
  const [chatMode, setChatMode] = useState<'general' | 'private'>('general');
  const [showPassengerInbox, setShowPassengerInbox] = useState(false);
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
        onTabChange={setActiveTab}
        onLogout={handleLogout}
      />


      {/* ÁREA DE CONTENIDO PRINCIPAL */}
      <main className="main-content" style={mainContentWrapperStyle}>
        <DashboardHeader
          activeTab={activeTab}
          isDark={isDark}
          user={user}
          onToggleTheme={toggleTheme}
        />

        {user?.tipoRol === 'Piloto' && (
          <PilotTrackingBar
            activeTrip={activeTrip}
            loading={loadingActiveTrip}
            tracking={pilotTracking}
          />
        )}


        {/* VISTA DE TRACKING SPLIT-SCREEN (MAPA + LISTA DE UNIDADES SAAS) */}
        {(activeTab === 'map' || activeTab === 'telemetry') && (
          <div className="tracking-grid" style={{ display: 'flex', gap: '24px', width: '100%', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <section className="fleet-quickbar" aria-label="Resumen de flota">
              <div className="quickbar-lead"><span className="section-eyebrow"><Navigation size={13} /> Pulso de la operación</span><strong>Flota en movimiento</strong></div>
              <div className="quickbar-metric"><span>Transmitiendo</span><strong>{getDeduplicatedLiveBuses(liveBuses).filter(b => !b.isPrivacyMode && isTelemetryFresh(b, freshnessTimestamp) && hasValidCoordinates(b.latitud, b.longitud)).length}</strong></div>
              <div className="quickbar-metric"><span>Flota registrada</span><strong>{getTrackingFleet().length}</strong></div>
              <div className="quickbar-metric"><span>Privacidad</span><strong>{getDeduplicatedLiveBuses(liveBuses).filter(b => b.isPrivacyMode).length}</strong></div>
              <div className="quickbar-metric"><span>Sin señal GPS</span><strong>{getTrackingFleet().filter(b => !b.isPrivacyMode && (!isTelemetryFresh(b, freshnessTimestamp) || !hasValidCoordinates(b.latitud, b.longitud))).length}</strong></div>
              <div className="quickbar-sync"><Radio size={14} /><span>{lastTelemetrySyncAt ? `Actualizado ${new Date(lastTelemetrySyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Sin sincronizar'}</span></div>
            </section>
            {/* Columna Izquierda: Feed de Vehículos / Bookings */}
            <div className="fleet-panel" style={{
              width: '360px',
              maxWidth: '100%',
              backgroundColor: isDark ? '#111827' : '#ffffff',
              borderRadius: '20px',
              border: `1px solid ${isDark ? '#1f2937' : '#e2e8f0'}`,
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: isDark ? '0 4px 20px -2px rgba(0, 0, 0, 0.4)' : '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
              boxSizing: 'border-box',
              maxHeight: 'calc(100vh - 160px)',
              overflowY: 'auto'
            }}>
              {/* Toggle Pills: [ En Ruta ] [ Flota Completa ] */}
              <div style={{
                display: 'flex',
                backgroundColor: isDark ? '#1f2937' : '#f1f5f9',
                padding: '4px',
                borderRadius: '12px',
                gap: '4px'
              }}>
                <button
                  type="button"
                  onClick={() => setTrackingTabFilter('active')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '9px',
                    border: 'none',
                    backgroundColor: trackingTabFilter === 'active' ? 'var(--accent)' : 'transparent',
                    color: trackingTabFilter === 'active' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    boxShadow: trackingTabFilter === 'active' ? '0 7px 18px var(--accent-shadow)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <Radio size={14} />
                  <span>En Vivo ({getDeduplicatedLiveBuses(liveBuses).filter(b => !b.isPrivacyMode && isTelemetryFresh(b, freshnessTimestamp) && hasValidCoordinates(b.latitud, b.longitud)).length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTrackingTabFilter('all')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '9px',
                    border: 'none',
                    backgroundColor: trackingTabFilter === 'all' ? 'var(--accent)' : 'transparent',
                    color: trackingTabFilter === 'all' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    boxShadow: trackingTabFilter === 'all' ? '0 7px 18px var(--accent-shadow)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <Bus size={14} />
                  <span>Flota ({getTrackingFleet().length})</span>
                </button>
              </div>

              {/* Input de Búsqueda */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Buscar unidad, piloto o ruta..."
                  value={trackingSearchQuery}
                  onChange={(e) => setTrackingSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px 10px 38px',
                    borderRadius: '10px',
                    border: `1.5px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                    backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                    color: isDark ? '#f8fafc' : '#0f172a',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ position: 'absolute', left: '12px', top: '11px', color: isDark ? '#64748b' : '#94a3b8', display: 'flex', alignItems: 'center' }}>
                  <Search size={16} />
                </span>
              </div>

              {/* Lista de Tarjetas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(() => {
                  const busList = getTrackingFleet();
                  const filtered = (trackingTabFilter === 'active'
                    ? busList.filter(b => !b.isPrivacyMode && isTelemetryFresh(b, freshnessTimestamp) && hasValidCoordinates(b.latitud, b.longitud))
                    : busList
                  ).filter(b => {
                    if (!trackingSearchQuery) return true;
                    const q = trackingSearchQuery.toLowerCase();
                    return (
                      b.placaAutobus?.toLowerCase().includes(q) ||
                      b.nombrePiloto?.toLowerCase().includes(q) ||
                      b.nombreRuta?.toLowerCase().includes(q)
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', color: isDark ? '#64748b' : '#94a3b8', fontSize: '0.85rem', padding: '30px 10px' }}>
                        {trackingTabFilter === 'active' ? 'No hay unidades transmitiendo en este momento.' : 'No se encontraron unidades registradas.'}
                      </div>
                    );
                  }

                  return filtered.map((bus) => {
                    const isPriv = Boolean(bus.isPrivacyMode);
                    const isFresh = isTelemetryFresh(bus, freshnessTimestamp);
                    const hasPosition = isFresh && hasValidCoordinates(bus.latitud, bus.longitud);
                    const isStale = !bus.isOffline && !isPriv && !isFresh;
                    return (
                      <div
                        className={`fleet-tracking-card${bus.isOffline ? ' is-offline' : ''}`}
                        key={bus.placaAutobus}
                        role={hasPosition ? 'button' : undefined}
                        tabIndex={hasPosition ? 0 : undefined}
                        aria-label={hasPosition ? `Enfocar unidad ${bus.placaAutobus} en el mapa` : undefined}
                        aria-pressed={hasPosition ? focusedBusPlaca === bus.placaAutobus : undefined}
                        onClick={() => {
                          if (hasPosition) setFocusedBusPlaca(bus.placaAutobus);
                        }}
                        onKeyDown={(event) => {
                          if (hasPosition && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault();
                            setFocusedBusPlaca(bus.placaAutobus);
                          }
                        }}
                        style={{
                          backgroundColor: isDark ? '#1f2937' : '#ffffff',
                          border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                          borderRadius: '16px',
                          padding: '16px',
                          cursor: hasPosition ? 'pointer' : 'default',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                          boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.02)',
                          userSelect: 'none'
                        }}
                      >
                        {/* Header: Placa */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: isDark ? '#94a3b8' : '#64748b' }}>
                            Unidad Asignada
                          </span>
                          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: isDark ? '#f8fafc' : '#0f172a' }}>
                            {bus.placaAutobus}
                          </span>
                        </div>

                        {/* Driver Info */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '12px',
                            backgroundColor: isDark ? '#111827' : '#f1f5f9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            color: 'var(--accent)',
                            border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`
                          }}>
                            {bus.nombrePiloto?.charAt(0) || 'P'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: isDark ? '#f8fafc' : '#0f172a' }}>
                              {bus.nombrePiloto || 'Piloto'}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: isDark ? '#94a3b8' : '#64748b' }}>
                              {bus.isOffline
                                ? (bus.marcaModelo || 'Unidad registrada · sin conexión')
                                : (bus.destinoNombre ? `Destino: ${bus.destinoNombre}` : (bus.nombreRuta && bus.nombreRuta !== 'N/D' && bus.nombreRuta !== 'Sin Ruta Asignada' ? `Ruta: ${bus.nombreRuta}` : 'Sin ruta asignada'))}
                            </span>
                          </div>
                          {hasPosition && (
                            <div style={{
                              backgroundColor: isDark ? 'rgba(5, 150, 105, 0.15)' : '#ecfdf5',
                              border: `1px solid ${isDark ? 'rgba(5, 150, 105, 0.3)' : '#a7f3d0'}`,
                              color: isDark ? '#34d399' : '#059669',
                              borderRadius: '8px',
                              padding: '3px 8px',
                              fontSize: '0.75rem',
                              fontWeight: 700
                            }}>
                              {bus.velocidadKmh || 0} km/h
                            </div>
                          )}
                        </div>

                        {/* Footer con Estado */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '6px', borderTop: `1px solid ${isDark ? '#374151' : '#f1f5f9'}` }}>
                          <span style={{ fontSize: '0.74rem', color: isDark ? '#64748b' : '#94a3b8' }}>
                            {bus.fechaHoraDispositivo
                              ? new Date(bus.fechaHoraDispositivo).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : (bus.isOffline ? 'Sin transmisión reciente' : 'En línea')}
                          </span>
                          <span style={{
                            backgroundColor: hasPosition ? (isDark ? 'rgba(5, 150, 105, 0.15)' : '#ecfdf5') : (isDark ? '#111827' : '#f1f5f9'),
                            border: `1px solid ${hasPosition ? (isDark ? 'rgba(5, 150, 105, 0.3)' : '#a7f3d0') : (isDark ? '#374151' : '#e2e8f0')}`,
                            color: hasPosition ? (isDark ? '#34d399' : '#059669') : (isDark ? '#94a3b8' : '#64748b'),
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: '8px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            {hasPosition ? (
                              <>
                                <Radio size={12} />
                                <span>En Rastreo</span>
                              </>
                            ) : (
                              <span>{isPriv ? 'Privacidad' : (bus.isOffline ? 'Fuera de línea' : (isStale ? 'Sin señal reciente' : 'GPS no disponible'))}</span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Columna Derecha: Mapa Interactivo con Tarjeta Flotante */}
            <div className="map-panel" style={{ flex: 1, minWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
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

              {/* Tarjeta Flotante Inferior en el Mapa (Overlay SaaS) */}
              {(() => {
                const focusedBus = (focusedBusPlaca ? liveBuses[focusedBusPlaca] : undefined)
                  || Object.values(liveBuses).find(b => !b.isPrivacyMode && hasValidCoordinates(b.latitud, b.longitud));

                if (!focusedBus) return null;

                const isPriv = Boolean(focusedBus.isPrivacyMode);
                const hasPosition = hasValidCoordinates(focusedBus.latitud, focusedBus.longitud);

                return (
                  <div style={{
                    position: 'absolute',
                    bottom: '24px',
                    left: '24px',
                    right: '24px',
                    backgroundColor: isDark ? '#111827' : '#ffffff',
                    border: `1px solid ${isDark ? '#1f2937' : '#e2e8f0'}`,
                    borderRadius: '18px',
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: isDark ? '0 10px 30px -5px rgba(0, 0, 0, 0.6)' : '0 10px 30px -5px rgba(0, 0, 0, 0.15)',
                    zIndex: 500,
                    flexWrap: 'wrap',
                    gap: '14px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{
                        width: '46px',
                        height: '46px',
                        borderRadius: '14px',
                        backgroundColor: 'var(--accent-soft)',
                        border: '1px solid var(--accent-line)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '1rem',
                        color: 'var(--accent)'
                      }}>
                        {focusedBus.nombrePiloto?.charAt(0) || 'P'}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '0.98rem', color: isDark ? '#f8fafc' : '#0f172a' }}>{focusedBus.nombrePiloto}</strong>
                          <span style={{ fontSize: '0.74rem', color: 'var(--accent)', backgroundColor: 'var(--accent-soft)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                            Piloto
                          </span>
                        </div>
                        <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: isDark ? '#94a3b8' : '#64748b' }}>
                          Ruta: <strong>{focusedBus.nombreRuta || 'Ruta Principal'}</strong> • Autobús: <strong>{focusedBus.placaAutobus}</strong>
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {hasPosition && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.72rem', color: isDark ? '#94a3b8' : '#64748b' }}>Velocidad</div>
                          <strong style={{ fontSize: '1rem', color: '#10b981' }}>{focusedBus.velocidadKmh || 0} km/h</strong>
                        </div>
                      )}
                      <span style={{
                        backgroundColor: hasPosition ? (isDark ? 'rgba(5, 150, 105, 0.15)' : '#ecfdf5') : (isDark ? '#111827' : '#f1f5f9'),
                        border: `1px solid ${hasPosition ? (isDark ? 'rgba(5, 150, 105, 0.3)' : '#a7f3d0') : (isDark ? '#374151' : '#e2e8f0')}`,
                        color: hasPosition ? (isDark ? '#34d399' : '#059669') : (isDark ? '#94a3b8' : '#64748b'),
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '5px 12px',
                        borderRadius: '8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        {hasPosition ? (
                          <>
                            <Radio size={12} />
                            <span>En Rastreo</span>
                          </>
                        ) : (
                          <span>{isPriv ? 'Privacidad' : 'GPS no disponible'}</span>
                        )}
                      </span>
                      {(() => {
                        const hasNavRoute = Boolean(hasPosition && focusedBus.isTripActive && hasValidCoordinates(focusedBus.destinoLat, focusedBus.destinoLng));
                        return (
                          <button
                            type="button"
                            disabled={!hasNavRoute}
                            onClick={() => {
                              if (!hasNavRoute) return;
                              handleToggleLiveRoute(focusedBus.placaAutobus);
                            }}
                            style={{
                              backgroundColor: activeLiveRoutePlaca === focusedBus.placaAutobus ? '#ef4444' : (hasNavRoute ? 'var(--accent)' : '#64748b'),
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '10px',
                              padding: '8px 14px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              cursor: hasNavRoute ? 'pointer' : 'default',
                              opacity: hasNavRoute ? 1 : 0.65,
                              pointerEvents: hasNavRoute ? 'auto' : 'none',
                              boxShadow: hasNavRoute ? '0 7px 18px var(--accent-shadow)' : 'none',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {activeLiveRoutePlaca === focusedBus.placaAutobus ? 'Ocultar Recorrido' : (hasNavRoute ? 'Trazar Recorrido' : 'Sin Ruta Establecida')}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

      {/* VISTA DE GESTIÓN DE USUARIOS (Solo Administrador y SuperAdministrador) */}
      {activeTab === 'users' && (user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador') && (
        <div className="dashboard-view data-view" style={usersContainerStyle}>
          <div className="data-view-header" style={tableHeaderStyle}>
            <h2 style={cardTitleStyle}>Administración de Usuarios</h2>
            <button className="button-with-icon" onClick={openCreateModal} style={addButtonStyle}>
              <Plus size={16} /> Agregar Usuario
            </button>
          </div>

          {crudError && (
            <div style={errorBannerStyle}>
               {crudError}
            </div>
          )}

          {loadingUsers ? (
            <div style={loadingTableStyle}>Cargando usuarios de SQL Server...</div>
          ) : (
            <div className="management-grid" aria-label="Personal registrado">
              {users.map((u) => (
                <article className="management-card person-card" key={u.idUsuario}>
                  <div className="management-card-top">
                    <div className="management-avatar"><Users size={20} /></div>
                    <div className="management-identity">
                      <span className="management-kicker">Personal #{String(u.idUsuario).padStart(2, '0')}</span>
                      <h3>{u.nombreCompleto}</h3>
                      <span className="management-handle">@{u.usuarioLogin}</span>
                    </div>
                    <span style={statusBadgeStyle(u.estado)}>{u.estado}</span>
                  </div>
                  <div className="management-details">
                    <div><span>Perfil operativo</span><strong>{u.tipoRol}</strong></div>
                    <div><span>Acceso</span><strong>{u.estado === 'Activo' ? 'Habilitado' : 'Suspendido'}</strong></div>
                  </div>
                  <div className="management-card-actions" style={actionGroupStyle}>
                    <button className="button-with-icon" onClick={() => openEditModal(u)} style={editButtonStyle}>
                      <Pencil size={14} /> Editar
                    </button>
                    <button
                      className="button-with-icon"
                      onClick={() => handleToggleEstado(u)}
                      style={u.estado === 'Activo' ? deactivateButtonStyle : activateButtonStyle}
                    >
                      {u.estado === 'Activo' ? <><UserRoundX size={14} /> Desactivar</> : <><UserRoundCheck size={14} /> Activar</>}
                    </button>
                    {u.usuarioLogin !== 'superadmin' && u.usuarioLogin !== 'admin' && (
                      <button className="icon-action danger" aria-label={`Eliminar a ${u.nombreCompleto}`} title="Eliminar" onClick={() => handleDeleteUser(u)} style={deleteButtonStyle}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL / FORMULARIO FLOTANTE (GLASSMORPHISM) */}
      {showModal && (
        <div className="modal-overlay" style={modalOverlayStyle}>
          <div className="modal-card" role="dialog" aria-modal="true" style={modalCardStyle}>
            <h3 style={modalTitleStyle}>
              {editingUserId === null ? 'Registrar Nuevo Usuario' : 'Editar Usuario'}
            </h3>
            
            <form onSubmit={handleSaveUser}>
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Nombre Completo</label>
                <input 
                  type="text" 
                  value={formNombre} 
                  onChange={(e) => setFormNombre(e.target.value)} 
                  style={formInputStyle} 
                  required 
                />
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Usuario de Login</label>
                <input 
                  type="text" 
                  value={formLogin} 
                  onChange={(e) => setFormLogin(e.target.value)} 
                  style={formInputStyle} 
                  required 
                />
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Rol</label>
                <AnimatedSelect
                  aria-label="Rol del usuario"
                  value={formRol} 
                  onChange={(e) => setFormRol(e.target.value as ManagedUser['tipoRol'])} 
                  style={formInputStyle}
                >
                  <option value="Piloto">Piloto</option>
                  <option value="Administrador">Administrador</option>
                  <option value="Supervisor">Supervisor</option>
                </AnimatedSelect>
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>
                  Contraseña {editingUserId !== null && '(Dejar vacío para conservar actual)'}
                </label>
                <input 
                  type="password" 
                  value={formContrasena} 
                  onChange={(e) => setFormContrasena(e.target.value)} 
                  style={formInputStyle} 
                  required={editingUserId === null}
                  minLength={formContrasena ? 12 : undefined}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder={editingUserId !== null ? 'Dejar vacío para conservarla' : 'Mínimo 12 caracteres'} 
                />
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Estado</label>
                <AnimatedSelect
                  aria-label="Estado del usuario"
                  value={formEstado} 
                  onChange={(e) => setFormEstado(e.target.value as ManagedUser['estado'])} 
                  style={formInputStyle}
                >
                  <option value="Activo">Activo</option>
                  <option value="Inactivo">Inactivo</option>
                </AnimatedSelect>
              </div>

              <div className="modal-actions" style={modalActionsStyle}>
                <button className="button-with-icon" type="button" onClick={() => setShowModal(false)} style={cancelButtonStyle}>
                  <X size={15} /> Cancelar
                </button>
                <button className="button-with-icon" type="submit" style={saveButtonStyle}>
                  <Save size={15} /> Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'routes' && canMonitorOperations && (
        <div className="dashboard-view data-view" style={usersContainerStyle}>
          <div className="data-view-header" style={tableHeaderStyle}>
            <div>
              <h2 style={{ ...cardTitleStyle, marginBottom: '4px' }}>Rutas guardadas</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                Trayectos reutilizables para asignar rápidamente a una unidad, como destinos frecuentes.
              </p>
            </div>
            {canManageOperations && (
              <button className="button-with-icon" type="button" onClick={openCreateRouteModal} style={addButtonStyle}>
                <Plus size={16} /> Nueva ruta
              </button>
            )}
          </div>

          {crudError && <div role="alert" style={errorBannerStyle}>{crudError}</div>}

          {routes.length === 0 ? (
            <div className="empty-state" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <MapPinned size={36} strokeWidth={1.5} style={{ marginBottom: '10px', color: 'var(--accent)' }} />
              <strong style={{ display: 'block', color: 'var(--ink)', marginBottom: '5px' }}>Todavía no hay rutas guardadas</strong>
              <span>Crea una desde aquí o deja que un piloto guarde el recorrido elegido en el mapa.</span>
            </div>
          ) : (
            <div className="management-grid routes-management-grid" aria-label="Catálogo de rutas guardadas">
              {routes.map((route) => (
                <article className="management-card route-card" key={route.idRuta} style={{ padding: '20px', minHeight: '210px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' }}>
                    <div style={{ minWidth: 0 }}>
                      <span className="management-kicker">Ruta #{String(route.idRuta).padStart(2, '0')}</span>
                      <h3 style={{ margin: '6px 0 0', color: 'var(--ink)', fontSize: '1.05rem' }}>{route.nombreRuta}</h3>
                    </div>
                    <div style={{ width: '42px', height: '42px', borderRadius: '13px', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
                      <MapPinned size={21} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', marginTop: '22px', gap: '0 10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent)', marginTop: '4px' }} />
                      <span style={{ width: '2px', minHeight: '37px', flex: 1, background: 'var(--line)', margin: '4px 0' }} />
                      <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#ef4444', marginBottom: '4px' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '18px', minWidth: 0 }}>
                      <div><span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Origen</span><strong style={{ display: 'block', color: 'var(--ink)', fontSize: '0.86rem', overflowWrap: 'anywhere' }}>{route.origen}</strong></div>
                      <div><span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Destino</span><strong style={{ display: 'block', color: 'var(--ink)', fontSize: '0.86rem', overflowWrap: 'anywhere' }}>{route.destino}</strong></div>
                    </div>
                  </div>

                  <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                    <span>{route.destinoLatitud != null && route.destinoLongitud != null ? 'Lista para navegación GPS' : 'Disponible para despacho'}</span>
                    <ArrowRight size={16} color="var(--accent)" />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {showRouteModal && (
        <div className="modal-overlay" style={modalOverlayStyle}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="route-modal-title" style={modalCardStyle}>
            <div style={{ width: '46px', height: '46px', borderRadius: '14px', display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', marginBottom: '14px' }}>
              <MapPin size={22} />
            </div>
            <h3 id="route-modal-title" style={modalTitleStyle}>{routeTripContext ? 'Guardar ruta del viaje' : 'Guardar nueva ruta'}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '-6px 0 18px' }}>
              {routeTripContext
                ? 'Nombra este recorrido. Se asociará al viaje actual y quedará disponible para futuros despachos.'
                : 'Define un trayecto frecuente. Después aparecerá al asignar rutas a viajes y autobuses.'}
            </p>
            {crudError && <div role="alert" style={{ ...errorBannerStyle, marginBottom: '16px' }}>{crudError}</div>}
            <form onSubmit={handleSaveAdminRoute}>
              <div style={formGroupStyle}>
                <label htmlFor="route-name" style={formLabelStyle}>Nombre de la ruta</label>
                <input id="route-name" value={formRouteName} onChange={(event) => setFormRouteName(event.target.value)} minLength={2} maxLength={100} required autoFocus placeholder="Ej. Terminal - Centro" style={formInputStyle} />
              </div>
              <div style={formGroupStyle}>
                <label htmlFor="route-origin" style={formLabelStyle}>Origen</label>
                <input id="route-origin" value={formRouteOrigin} onChange={(event) => setFormRouteOrigin(event.target.value)} minLength={2} maxLength={100} required placeholder="Ej. Terminal Minerva" style={formInputStyle} />
              </div>
              <div style={formGroupStyle}>
                <label htmlFor="route-destination" style={formLabelStyle}>Destino</label>
                <input id="route-destination" value={formRouteDestination} onChange={(event) => setFormRouteDestination(event.target.value)} minLength={2} maxLength={100} required placeholder="Ej. Parque Central" style={formInputStyle} />
              </div>
              <div className="modal-actions" style={modalActionsStyle}>
                <button className="button-with-icon" type="button" onClick={() => { setShowRouteModal(false); setRouteTripContext(null); }} style={cancelButtonStyle} disabled={routeSaving}><X size={15} /> Cancelar</button>
                <button className="button-with-icon" type="submit" style={{ ...saveButtonStyle, opacity: routeSaving ? 0.65 : 1 }} disabled={routeSaving}><Save size={15} /> {routeSaving ? 'Guardando…' : 'Guardar ruta'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* La supervisión puede consultar la flota; solo administración puede modificarla. */}
      {activeTab === 'buses' && canMonitorOperations && (
        <div className="dashboard-view data-view" style={usersContainerStyle}>
          <div className="data-view-header" style={tableHeaderStyle}>
            <h2 style={cardTitleStyle}>Administración de Autobuses</h2>
            {canManageOperations && (
              <button className="button-with-icon" onClick={openCreateBusModal} style={addButtonStyle}>
                <Plus size={16} /> Agregar Autobús
              </button>
            )}
          </div>

          {crudError && (
            <div style={errorBannerStyle}>
               {crudError}
            </div>
          )}

          {loadingBuses ? (
            <div style={loadingTableStyle}>Cargando autobuses de SQL Server...</div>
          ) : (
            <div className="management-grid fleet-management-grid" aria-label="Flota registrada">
              {buses.map((b) => {
                const activeTripForBus = trips.find(t => t.idAutobus === b.idAutobus && t.estadoViaje === 'En Curso');
                return (
                  <article className="management-card bus-card" key={b.idAutobus}>
                    <div className="bus-card-visual">
                      <span className="management-kicker">Unidad #{String(b.idAutobus).padStart(2, '0')}</span>
                      <Bus size={42} strokeWidth={1.5} />
                      <strong>{b.placa}</strong>
                    </div>
                    <div className="bus-card-content">
                      <div className="bus-card-heading">
                        <div>
                          <span className="management-kicker">Marca y modelo</span>
                          <h3>{b.marcaModelo || 'Sin especificar'}</h3>
                        </div>
                        <span style={statusBadgeStyle(b.estado)}>{b.estado}</span>
                      </div>
                      <div className="management-details compact">
                        <div><span>Piloto actual</span><strong>{activeTripForBus?.nombrePiloto || 'Sin asignación'}</strong></div>
                        <div><span>Disponibilidad</span><strong>{activeTripForBus ? 'En recorrido' : 'En base'}</strong></div>
                      </div>
                      {canManageOperations ? (
                        <div className="management-card-actions" style={actionGroupStyle}>
                          <button className="button-with-icon" onClick={() => openEditBusModal(b)} style={editButtonStyle}>
                            <Pencil size={14} /> Asignar o editar
                          </button>
                          <button className="icon-action danger" aria-label={`Eliminar unidad ${b.placa}`} title="Eliminar" onClick={() => handleDeleteBus(b.idAutobus)} style={deleteButtonStyle}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 700 }}>Solo lectura</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}


      {/* MODAL / FORMULARIO FLOTANTE AUTOBUSES */}
      {showBusModal && (
        <div className="modal-overlay" style={modalOverlayStyle}>
          <div className="modal-card" role="dialog" aria-modal="true" style={modalCardStyle}>
            <h3 style={modalTitleStyle}>
              {editingBusId === null ? 'Registrar Nuevo Autobús' : 'Editar Autobús'}
            </h3>

            {crudError && (
              <div role="alert" style={{ ...errorBannerStyle, marginBottom: '16px' }}>
                {crudError}
              </div>
            )}
             
            <form onSubmit={handleSaveBus}>
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Placa</label>
                <input 
                  type="text" 
                  value={formPlaca} 
                  onChange={(e) => setFormPlaca(e.target.value)} 
                  style={formInputStyle} 
                  required 
                  placeholder="Ej: P-123ABC"
                />
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Marca / Modelo</label>
                <input 
                  type="text" 
                  value={formMarcaModelo} 
                  onChange={(e) => setFormMarcaModelo(e.target.value)} 
                  style={formInputStyle} 
                  placeholder="Ej: Mercedes-Benz 2024"
                />
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Estado</label>
                <AnimatedSelect
                  aria-label="Estado del autobús"
                  value={formEstadoBus} 
                  onChange={(e) => setFormEstadoBus(e.target.value as Autobus['estado'])} 
                  style={formInputStyle}
                >
                  <option value="Activo">Activo</option>
                  <option value="Inactivo">Inactivo</option>
                  <option value="En Taller">En Taller</option>
                </AnimatedSelect>
              </div>

              <div style={formGroupStyle}>
                {editingBusId !== null && <label style={formLabelStyle}><input type="checkbox" checked={manageBusAssignment} onChange={e => setManageBusAssignment(e.target.checked)} /> Cambiar operación del viaje (opcional)</label>}
                <label style={formLabelStyle}>Piloto asignado — cambiarlo finaliza el viaje anterior</label>
                <AnimatedSelect
                  aria-label="Piloto asignado"
                  disabled={!manageBusAssignment}
                  value={formPilotoAsignado} 
                  onChange={(e) => {
                    const pilotId = Number(e.target.value);
                    setFormPilotoAsignado(pilotId);
                    if (pilotId === 0) setFormRutaAsignadaBus(0);
                  }} 
                  style={formInputStyle}
                >
                  <option value={0}>-- Sin Asignar / En Base --</option>
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
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Ruta Asignada (Opcional)</label>
                <AnimatedSelect
                  aria-label="Ruta asignada"
                  value={formRutaAsignadaBus} 
                  onChange={(e) => setFormRutaAsignadaBus(Number(e.target.value))} 
                  disabled={!manageBusAssignment || formPilotoAsignado === 0}
                  style={formInputStyle}
                >
                  <option value={0}>-- Sin Ruta Asignada (Predeterminado) --</option>
                  {routes.map(r => (
                    <option key={r.idRuta} value={r.idRuta}>
                      {r.nombreRuta} ({r.origen} a {r.destino})
                    </option>
                  ))}
                </AnimatedSelect>
              </div>

              <div className="modal-actions" style={modalActionsStyle}>
                <button className="button-with-icon" type="button" onClick={() => setShowBusModal(false)} style={cancelButtonStyle} disabled={busSaving}>
                  <X size={15} /> Cancelar
                </button>
                <button
                  className="button-with-icon"
                  type="submit"
                  style={{ ...saveButtonStyle, opacity: busSaving ? 0.65 : 1, cursor: busSaving ? 'wait' : 'pointer' }}
                  disabled={busSaving}
                >
                  <Save size={15} /> {busSaving ? 'Guardando…' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
        <div className="dashboard-view" style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
          
          <section className="telemetry-hero">
            <div className="telemetry-hero-copy">
              <span className="section-eyebrow"><Activity size={14} /> Panorama de seguridad</span>
              <h2>Riesgo vial, resumido para decidir</h2>
              <p>Señales críticas, conductores prioritarios y estado de la conexión en una sola lectura.</p>
            </div>
            <span className={`connection-pill ${wsConnected ? 'is-connected' : 'is-offline'}`}>
              <Wifi size={15} /> {wsConnected ? 'Telemetría conectada' : 'Telemetría desconectada'}
            </span>
          </section>

          <div className="telemetry-metrics">
            <article className="telemetry-metric is-critical">
              <div className="metric-icon"><ShieldAlert size={20} /></div>
              <div><span>Infracciones registradas</span><strong>{loadingStats ? '—' : Number(statTotalAlerts).toLocaleString()}</strong></div>
            </article>
            <article className="telemetry-metric">
              <div className="metric-icon"><Users size={20} /></div>
              <div><span>Conductor prioritario</span><strong>{statPilotosMasInfracciones[0]?.nombrePiloto || 'Sin datos'}</strong></div>
            </article>
            <article className="telemetry-metric">
              <div className="metric-icon"><Gauge size={20} /></div>
              <div><span>Evento más frecuente</span><strong>{Object.entries(statAlertsByTipo).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Sin eventos'}</strong></div>
            </article>
            <article className="telemetry-metric is-positive">
              <div className="metric-icon"><CheckCircle2 size={20} /></div>
              <div><span>Estado del sistema</span><strong>{wsConnected ? 'Operativo' : 'Sin conexión'}</strong></div>
            </article>
          </div>

          <div className="telemetry-insights">
            <section className="insight-card live-events-card">
              <div className="insight-heading">
                <div><span className="section-eyebrow"><Radio size={13} /> Flujo en vivo</span><h3>Eventos recientes</h3></div>
                <span>{alerts.length} activos</span>
              </div>
              <div className="live-event-list">
                {loadingAlerts ? (
                  <div className="insight-empty">Consultando telemetría…</div>
                ) : alerts.length === 0 ? (
                  <div className="insight-empty success"><CheckCircle2 size={20} /> Sin incidencias recientes</div>
                ) : alerts.slice(0, 5).map((a) => (
                  <div className="live-event-row" key={a.idAlerta}>
                    <span className="event-severity" />
                    <div><strong>{a.tipoAlerta}</strong><span>{a.nombrePiloto} · {a.placaAutobus}</span></div>
                    <time>{new Date(a.fechaHora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                ))}
              </div>
            </section>

            <section className="insight-card risk-card">
              <div className="insight-heading"><div><span className="section-eyebrow"><BarChart3 size={13} /> Análisis</span><h3>Concentración de riesgo</h3></div></div>
              <div className="risk-columns">
                <div><h4>Por tipo de alerta</h4>{Object.entries(statAlertsByTipo).slice(0, 3).map(([tipo, cantidad]) => {
                  const maxVal = Math.max(...Object.values(statAlertsByTipo), 1);
                  const percentage = Math.round((cantidad / maxVal) * 100);
                  return <div className="risk-row" key={tipo}><div><span>{tipo}</span><strong>{cantidad}</strong></div><div className="risk-track"><i style={{ width: `${percentage}%` }} /></div></div>;
                })}</div>
                <div><h4>Conductores con más eventos</h4>{statPilotosMasInfracciones.slice(0, 3).map((p, idx) => {
                  const maxVal = statPilotosMasInfracciones[0]?.cantidadAlertas || 1;
                  const percentage = Math.round((p.cantidadAlertas / maxVal) * 100);
                  return <div className="risk-row" key={`${p.nombrePiloto}-${idx}`}><div><span>{idx + 1}. {p.nombrePiloto}</span><strong>{p.cantidadAlertas}</strong></div><div className="risk-track"><i style={{ width: `${percentage}%` }} /></div></div>;
                })}</div>
              </div>
            </section>
          </div>

          {/* FILA INFERIOR: Historial y Auditoría de Alertas (Tabla compacta y estilizada) */}
          <div className="alert-history data-view" style={{
            ...usersContainerStyle,
            padding: '18px',
            borderRadius: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <div className="alert-history-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <h2 style={{ ...cardTitleStyle, fontSize: '0.92rem', margin: 0 }}>Historial y Auditoría de Alertas</h2>
              <div className="alert-export-actions" style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="button-with-icon secondary-action" disabled={exportingReport !== null} onClick={handleExportPdf} style={{ ...addButtonStyle, padding: '6px 12px', fontSize: '0.76rem', borderRadius: '8px' }}>
                  <FileDown size={14} /> {exportingReport === 'pdf' ? 'Generando…' : 'Exportar PDF'}
                </button>
                <button type="button" className="button-with-icon secondary-action" disabled={exportingReport !== null} onClick={handleExportExcel} style={{ ...addButtonStyle, padding: '6px 12px', fontSize: '0.76rem', borderRadius: '8px' }}>
                  <Sheet size={14} /> {exportingReport === 'excel' ? 'Generando…' : 'Exportar Excel'}
                </button>
              </div>
            </div>

            {/* Barra de Filtros Compacta */}
            <div className="filter-bar" style={{ 
              display: 'flex', 
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: '8px', 
              padding: '12px', 
              borderRadius: '10px', 
              backgroundColor: 'var(--surface-soft)',
              border: '1px solid var(--line)',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              <div style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '0.68rem', color: isDark ? '#cbd5e1' : '#18181b', fontWeight: 700 }}>Fecha Inicio</label>
                <input 
                  type="date" 
                  value={filterFechaInicio}
                  onChange={(e) => setFilterFechaInicio(e.target.value)}
                  style={{ ...formInputStyle, padding: '4px 8px', height: '30px', minHeight: 'unset', fontSize: '0.76rem', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                />
              </div>
              <div style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '0.68rem', color: isDark ? '#cbd5e1' : '#18181b', fontWeight: 700 }}>Fecha Fin</label>
                <input 
                  type="date" 
                  value={filterFechaFin}
                  onChange={(e) => setFilterFechaFin(e.target.value)}
                  style={{ ...formInputStyle, padding: '4px 8px', height: '30px', minHeight: 'unset', fontSize: '0.76rem', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                />
              </div>
              <div style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '0.68rem', color: isDark ? '#cbd5e1' : '#18181b', fontWeight: 700 }}>Piloto</label>
                <AnimatedSelect
                  aria-label="Filtrar alertas por piloto"
                  value={filterPiloto}
                  onChange={(e) => setFilterPiloto(e.target.value)}
                  style={{ ...formInputStyle, padding: '4px 8px', height: '30px', minHeight: 'unset', fontSize: '0.76rem', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                >
                  <option value="">Todos los Pilotos</option>
                  {users
                    .filter(u => u.tipoRol === 'Piloto')
                    .map(u => (
                      <option key={u.idUsuario} value={u.idUsuario}>{u.nombreCompleto}</option>
                    ))}
                </AnimatedSelect>
              </div>
              <div style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '0.68rem', color: isDark ? '#cbd5e1' : '#18181b', fontWeight: 700 }}>Tipo Alerta</label>
                <AnimatedSelect
                  aria-label="Filtrar por tipo de alerta"
                  value={filterTipoAlerta}
                  onChange={(e) => setFilterTipoAlerta(e.target.value)}
                  style={{ ...formInputStyle, padding: '4px 8px', height: '30px', minHeight: 'unset', fontSize: '0.76rem', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                >
                  <option value="">Todas las Alertas</option>
                  <option value="Exceso de Velocidad">Exceso de Velocidad</option>
                  <option value="Frenado Brusco">Frenado Brusco</option>
                  <option value="Aceleración Peligrosa">Aceleración Peligrosa</option>
                  <option value="Giro Brusco">Giro Brusco</option>
                </AnimatedSelect>
              </div>
              <div className="filter-actions" style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                <button 
                  type="button"
                  onClick={fetchHistoricalAlerts} 
                  style={{ ...addButtonStyle, padding: '4px 12px', height: '30px', fontSize: '0.76rem', borderRadius: '8px', whiteSpace: 'nowrap' }}
                >
                  Filtrar
                </button>
                <button 
                  type="button"
                  onClick={handleClearFilters} 
                  style={{
                    backgroundColor: isDark ? '#111827' : '#ffffff',
                    border: `1.5px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                    color: isDark ? '#cbd5e1' : '#64748b',
                    borderRadius: '8px',
                    padding: '4px 10px',
                    height: '30px',
                    fontWeight: 600,
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Limpiar
                </button>
              </div>
            </div>

            {loadingHistorical ? (
              <div style={loadingTableStyle}>Cargando histórico de alertas de SQL Server...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="responsive-table" style={{ ...tableWrapperStyle, maxHeight: 'calc(100vh - 380px)', minHeight: '180px', overflowY: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, padding: '8px 10px', fontSize: '0.78rem' }}>ID</th>
                        <th style={{ ...thStyle, padding: '8px 10px', fontSize: '0.78rem' }}>Fecha / Hora</th>
                        <th style={thStyle}>Tipo de Alerta</th>
                        <th style={thStyle}>Conductor</th>
                        <th style={thStyle}>Autobús</th>
                        <th style={thStyle}>Ruta</th>
                        <th style={thStyle}>Valor Registrado</th>
                        <th style={thStyle}>Límite Permitido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalAlerts.length === 0 ? (
                        <tr>
                          <td className="responsive-table-empty" colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#475569', padding: '20px' }}>
                            No se encontraron registros de alertas con los filtros seleccionados.
                          </td>
                        </tr>
                      ) : (
                        historicalAlerts
                          .slice((alertsPage - 1) * alertsPageSize, alertsPage * alertsPageSize)
                          .map((a) => (
                            <tr key={a.idAlerta} style={trStyle}>
                              <td data-label="ID" style={tdStyle}>{a.idAlerta}</td>
                              <td data-label="Fecha / hora" style={tdStyle}>{new Date(a.fechaHora).toLocaleString()}</td>
                              <td data-label="Tipo" style={{ ...tdStyle, color: '#dc2626', fontWeight: 700 }}>{a.tipoAlerta}</td>
                              <td data-label="Conductor" style={tdStyle}>{a.nombrePiloto}</td>
                              <td data-label="Autobús" style={tdStyle}>{a.placaAutobus}</td>
                              <td data-label="Ruta" style={tdStyle}>{a.nombreRuta}</td>
                              <td data-label="Valor" style={{ ...tdStyle, fontWeight: 'bold' }}>{a.valorRegistrado}</td>
                              <td data-label="Límite" style={tdStyle}>{a.limitePermitido}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Controles de Paginación */}
                {historicalAlerts.length > 0 && (
                  <div className="table-pagination" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 14px',
                    borderTop: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                    backgroundColor: isDark ? '#111827' : '#ffffff',
                    borderRadius: '0 0 12px 12px',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}>
                    <div className="table-pagination-summary" style={{ fontSize: '0.76rem', color: isDark ? '#94a3b8' : '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>
                        Mostrando <strong>{(alertsPage - 1) * alertsPageSize + 1} - {Math.min(alertsPage * alertsPageSize, historicalAlerts.length)}</strong> de <strong>{historicalAlerts.length.toLocaleString()}</strong> alertas
                      </span>
                      <span>•</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>Por página:</span>
                        <AnimatedSelect
                          aria-label="Alertas por página"
                          value={alertsPageSize}
                          onChange={(e) => {
                            setAlertsPageSize(Number(e.target.value));
                            setAlertsPage(1);
                          }}
                          style={{
                            width: '68px',
                            backgroundColor: isDark ? '#1f2937' : '#f1f5f9',
                            color: isDark ? '#f8fafc' : '#0f172a',
                            border: `1px solid ${isDark ? '#374151' : '#cbd5e1'}`,
                            borderRadius: '6px',
                            padding: '2px 6px',
                            fontSize: '0.74rem',
                            cursor: 'pointer'
                          }}
                        >
                          <option value={5}>5</option>
                          <option value={10}>10</option>
                          <option value={20}>20</option>
                          <option value={50}>50</option>
                        </AnimatedSelect>
                      </div>
                    </div>

                    <div className="table-pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        disabled={alertsPage <= 1}
                        onClick={() => setAlertsPage(1)}
                        title="Primera página"
                        style={{
                          backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                          color: alertsPage <= 1 ? (isDark ? '#4b5563' : '#cbd5e1') : (isDark ? '#f8fafc' : '#0f172a'),
                          border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                          borderRadius: '6px',
                          padding: '3px 7px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: alertsPage <= 1 ? 'not-allowed' : 'pointer',
                          opacity: alertsPage <= 1 ? 0.4 : 1
                        }}
                      >
                        ««
                      </button>

                      <button
                        type="button"
                        disabled={alertsPage <= 1}
                        onClick={() => setAlertsPage(prev => Math.max(1, prev - 1))}
                        style={{
                          backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                          color: alertsPage <= 1 ? (isDark ? '#4b5563' : '#cbd5e1') : (isDark ? '#f8fafc' : '#0f172a'),
                          border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                          borderRadius: '6px',
                          padding: '3px 8px',
                          fontSize: '0.74rem',
                          fontWeight: 600,
                          cursor: alertsPage <= 1 ? 'not-allowed' : 'pointer',
                          opacity: alertsPage <= 1 ? 0.4 : 1
                        }}
                      >
                        ‹ Anterior
                      </button>

                      <span style={{
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        color: 'var(--accent)',
                        padding: '3px 9px',
                        backgroundColor: 'var(--accent-soft)',
                        border: '1px solid var(--accent-line)',
                        borderRadius: '6px'
                      }}>
                        {alertsPage} / {Math.max(1, Math.ceil(historicalAlerts.length / alertsPageSize))}
                      </span>

                      <button
                        type="button"
                        disabled={alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize)}
                        onClick={() => setAlertsPage(prev => Math.min(Math.ceil(historicalAlerts.length / alertsPageSize), prev + 1))}
                        style={{
                          backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                          color: alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize) ? (isDark ? '#4b5563' : '#cbd5e1') : (isDark ? '#f8fafc' : '#0f172a'),
                          border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                          borderRadius: '6px',
                          padding: '3px 8px',
                          fontSize: '0.74rem',
                          fontWeight: 600,
                          cursor: alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize) ? 'not-allowed' : 'pointer',
                          opacity: alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize) ? 0.4 : 1
                        }}
                      >
                        Siguiente ›
                      </button>

                      <button
                        type="button"
                        disabled={alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize)}
                        onClick={() => setAlertsPage(Math.max(1, Math.ceil(historicalAlerts.length / alertsPageSize)))}
                        title="Última página"
                        style={{
                          backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                          color: alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize) ? (isDark ? '#4b5563' : '#cbd5e1') : (isDark ? '#f8fafc' : '#0f172a'),
                          border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                          borderRadius: '6px',
                          padding: '3px 7px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize) ? 'not-allowed' : 'pointer',
                          opacity: alertsPage >= Math.ceil(historicalAlerts.length / alertsPageSize) ? 0.4 : 1
                        }}
                      >
                        »»
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}


      {/* MODAL / FORMULARIO FLOTANTE DE DESPACHO DE VIAJES */}
      {showTripModal && (
        <div className="modal-overlay" style={modalOverlayStyle}>
          <div className="modal-card" role="dialog" aria-modal="true" style={modalCardStyle}>
            <h3 style={modalTitleStyle}>Registrar Despacho de Viaje</h3>
            
            <form onSubmit={handleSaveTrip}>
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Piloto Disponible</label>
                <AnimatedSelect
                  aria-label="Piloto disponible"
                  value={formTripPiloto} 
                  onChange={(e) => setFormTripPiloto(Number(e.target.value))} 
                  style={formInputStyle}
                  required
                >
                  <option value="">-- Seleccionar Piloto --</option>
                  {users
                    .filter(u => u.tipoRol === 'Piloto' && u.estado === 'Activo' && !trips.some(t => t.idUsuario === u.idUsuario && t.estadoViaje === 'En Curso'))
                    .map(u => (
                      <option key={u.idUsuario} value={u.idUsuario}>{u.nombreCompleto}</option>
                    ))
                  }
                </AnimatedSelect>
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Autobús Disponible</label>
                <AnimatedSelect
                  aria-label="Autobús disponible"
                  value={formTripBus} 
                  onChange={(e) => setFormTripBus(Number(e.target.value))} 
                  style={formInputStyle}
                  required
                >
                  <option value="">-- Seleccionar Autobús --</option>
                  {buses
                    .filter(b => b.estado === 'Activo' && !trips.some(t => t.idAutobus === b.idAutobus && t.estadoViaje === 'En Curso'))
                    .map(b => (
                      <option key={b.idAutobus} value={b.idAutobus}>{b.placa} ({b.marcaModelo || 'Sin marca'})</option>
                    ))
                  }
                </AnimatedSelect>
              </div>

              <div style={formGroupStyle}>
                <label style={formLabelStyle}>Ruta Asignada (Opcional)</label>
                <AnimatedSelect
                  aria-label="Ruta del viaje"
                  value={formTripRoute} 
                  onChange={(e) => setFormTripRoute(Number(e.target.value))} 
                  style={formInputStyle}
                >
                  <option value={0}>-- Sin Ruta / Tránsito Libre --</option>
                  {routes.map(r => (
                    <option key={r.idRuta} value={r.idRuta}>{r.nombreRuta} ({r.origen} a {r.destino})</option>
                  ))}
                </AnimatedSelect>
              </div>

              <div className="modal-actions" style={modalActionsStyle}>
                <button type="button" onClick={() => setShowTripModal(false)} style={cancelButtonStyle}>
                  Cancelar
                </button>
                <button type="submit" style={saveButtonStyle}>
                  Iniciar Viaje (Despachar)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VISTA DE ACTIVIDAD / HISTORIAL DE VIAJES (Inspirada en Uber Activity & Trip Details) */}
      {activeTab === 'activity' && (
        <div className="dashboard-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
          {/* Tarjeta de Viaje Activo para el Piloto */}
          {user?.tipoRol === 'Piloto' && (
            <div style={cardStyle}>
              <h3 style={{ ...cardTitleStyle, marginBottom: '12px' }}>Tu Viaje Asignado Actual</h3>
              {loadingActiveTrip ? (
                <div style={{ color: '#64748b', textAlign: 'center', padding: '16px' }}>
                  Consultando base de datos de despacho...
                </div>
              ) : activeTrip ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                    <span style={{ color: '#64748b', fontSize: '0.86rem' }}>Ruta Asignada:</span>
                    <strong style={{ color: 'var(--accent)' }}>{activeTrip.nombreRuta || 'N/D'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                    <span style={{ color: '#64748b', fontSize: '0.86rem' }}>Autobús (Placa):</span>
                    <strong style={{ color: '#0f172a' }}>{activeTrip.placaAutobus}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                    <span style={{ color: '#64748b', fontSize: '0.86rem' }}>Hora de Inicio:</span>
                    <span style={{ color: '#0f172a' }}>{new Date(activeTrip.fechaInicio).toLocaleString()}</span>
                  </div>
                   <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                     <span style={{ color: '#64748b', fontSize: '0.86rem' }}>Estado:</span>
                     <span style={{ color: '#059669', fontWeight: 600, backgroundColor: '#ecfdf5', padding: '2px 8px', borderRadius: '6px' }}>{activeTrip.estadoViaje}</span>
                   </div>
                   <button
                     type="button"
                     className="button-with-icon"
                     onClick={() => handleFinalizeTrip(activeTrip.idViaje)}
                     style={{ ...saveButtonStyle, marginTop: '8px', width: '100%', justifyContent: 'center' }}
                   >
                     <CheckCircle2 size={16} /> Finalizar recorrido y quedar disponible
                   </button>
                 </div>
              ) : (
                <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', fontSize: '0.86rem' }}>
                  <strong>Sin Viaje Asignado:</strong> No tienes ningún viaje activo en este momento. Comunícate con tu supervisor para tu asignación.
                </div>
              )}
            </div>
          )}

          {/* Cabecera y Filtros de Actividad */}
          <div className="data-view activity-panel" style={usersContainerStyle}>
            <div className="activity-toolbar" style={{ ...tableHeaderStyle, flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h2 style={{ ...cardTitleStyle, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {user?.tipoRol === 'Piloto' ? 'Mis Rutas y Viajes Asignados' : 'Actividad e Historial de Recorridos'}
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '0.86rem', margin: '4px 0 0 0' }}>
                    {user?.tipoRol === 'Piloto'
                      ? 'Historial de tus viajes realizados, rutas cubiertas y autobuses asignados'
                      : 'Auditoría cronológica de todos los viajes despachados y operados en la flota'}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {/* Selector Segmentado de Rango: Última Semana vs Ver Todos */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: isDark ? '#1f2937' : '#f1f5f9',
                    padding: '3px',
                    borderRadius: '12px',
                    border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                    gap: '3px'
                  }}>
                    <button
                      type="button"
                      onClick={() => setActivityTimeRange('week')}
                      style={{
                        backgroundColor: activityTimeRange === 'week' ? 'var(--accent)' : 'transparent',
                        color: activityTimeRange === 'week' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
                        border: 'none',
                        borderRadius: '9px',
                        padding: '6px 14px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                        boxShadow: activityTimeRange === 'week' ? '0 7px 18px var(--accent-shadow)' : 'none'
                      }}
                    >
                      Última Semana
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivityTimeRange('all')}
                      style={{
                        backgroundColor: activityTimeRange === 'all' ? 'var(--accent)' : 'transparent',
                        color: activityTimeRange === 'all' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
                        border: 'none',
                        borderRadius: '9px',
                        padding: '6px 14px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                        boxShadow: activityTimeRange === 'all' ? '0 7px 18px var(--accent-shadow)' : 'none'
                      }}
                    >
                      Ver Todos
                    </button>
                  </div>

                  {(user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador') && (
                    <button onClick={openCreateTripModal} style={addButtonStyle}>
                      Nuevo Despacho
                    </button>
                  )}
                </div>
              </div>

              {/* Barra de Filtros y Búsqueda Compacta */}
              <div className="activity-filters" style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                gap: '12px',
                padding: '14px 16px',
                borderRadius: '16px',
                backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                width: '100%',
                boxSizing: 'border-box'
              }}>
                <div style={{ flex: '2 1 200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.76rem', color: isDark ? '#cbd5e1' : '#475569', fontWeight: 600 }}>Buscar Ruta / Destino / Placa</label>
                  <input
                    type="text"
                    placeholder="Ej: XELABUS, Terminal, C-102BKL..."
                    value={activitySearchQuery}
                    onChange={(e) => setActivitySearchQuery(e.target.value)}
                    style={{ ...formInputStyle, padding: '8px 12px', height: '38px', minHeight: 'unset', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                  />
                </div>

                {(user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador' || user?.tipoRol === 'Supervisor') && (
                  <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.76rem', color: isDark ? '#cbd5e1' : '#475569', fontWeight: 600 }}>Filtrar por Piloto</label>
                    <AnimatedSelect
                      aria-label="Filtrar actividad por piloto"
                      value={activityFilterPilot}
                      onChange={(e) => setActivityFilterPilot(e.target.value)}
                      style={{ ...formInputStyle, padding: '8px 12px', height: '38px', minHeight: 'unset', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                    >
                      <option value="">Todos los Pilotos</option>
                      {users.filter(u => u.tipoRol === 'Piloto').map(u => (
                        <option key={u.idUsuario} value={u.idUsuario}>{u.nombreCompleto}</option>
                      ))}
                    </AnimatedSelect>
                  </div>
                )}

                <div style={{ flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.76rem', color: isDark ? '#cbd5e1' : '#475569', fontWeight: 600 }}>Estado del Viaje</label>
                  <AnimatedSelect
                    aria-label="Filtrar actividad por estado"
                    value={activityFilterStatus}
                    onChange={(e) => setActivityFilterStatus(e.target.value)}
                    style={{ ...formInputStyle, padding: '8px 12px', height: '38px', minHeight: 'unset', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                  >
                    <option value="">Todos los Estados</option>
                    <option value="En Curso">En Curso</option>
                    <option value="Completado">Completado</option>
                    <option value="Cancelado">Cancelado</option>
                  </AnimatedSelect>
                </div>

                <div style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.76rem', color: isDark ? '#cbd5e1' : '#475569', fontWeight: 600 }}>Fecha Específica</label>
                  <input
                    type="date"
                    value={activityFilterDate}
                    onChange={(e) => setActivityFilterDate(e.target.value)}
                    style={{ ...formInputStyle, padding: '8px 12px', height: '38px', minHeight: 'unset', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#374151' : '#e2e8f0', color: isDark ? '#f8fafc' : '#0f172a' }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActivitySearchQuery('');
                    setActivityFilterPilot('');
                    setActivityFilterStatus('');
                    setActivityFilterDate('');
                    setActivityTimeRange('week');
                  }}
                  style={{
                    backgroundColor: isDark ? '#111827' : '#ffffff',
                    border: `1.5px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                    color: isDark ? '#cbd5e1' : '#64748b',
                    borderRadius: '10px',
                    padding: '8px 16px',
                    height: '38px',
                    fontWeight: 600,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                    flexShrink: 0
                  }}
                >
                  Limpiar Filtros
                </button>
              </div>
            </div>

            {/* Feed de Tarjetas de Actividad (Estilo SaaS Moderno) */}
            {loadingTrips ? (
              <div style={loadingTableStyle}>Cargando historial de actividad...</div>
            ) : (
              <div className="activity-feed" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                {(() => {
                  const oneWeekAgo = new Date();
                  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                  oneWeekAgo.setHours(0, 0, 0, 0);

                  const filtered = trips.filter((t) => {
                    if (user?.tipoRol === 'Piloto') {
                      const matchId = t.idUsuario === user.idUsuario;
                      const matchName = t.nombrePiloto && user.nombreCompleto &&
                        t.nombrePiloto.trim().toLowerCase() === user.nombreCompleto.trim().toLowerCase();
                      if (!matchId && !matchName) return false;
                    }
                    const q = activitySearchQuery.trim().toLowerCase();
                    const matchesSearch =
                      q === '' ||
                      (t.nombreRuta && t.nombreRuta.toLowerCase().includes(q)) ||
                      t.placaAutobus.toLowerCase().includes(q) ||
                      t.nombrePiloto.toLowerCase().includes(q);

                    const matchesPilot =
                      activityFilterPilot === '' || t.idUsuario === Number(activityFilterPilot);

                    const matchesStatus =
                      activityFilterStatus === '' || t.estadoViaje === activityFilterStatus;

                    const matchesDate =
                      activityFilterDate === '' || (t.fechaInicio && t.fechaInicio.startsWith(activityFilterDate));

                    // Filtro de rango: 1 semana por defecto
                    let matchesTimeRange = true;
                    if (activityTimeRange === 'week' && !activityFilterDate) {
                      const tripDate = new Date(t.fechaInicio);
                      matchesTimeRange = !isNaN(tripDate.getTime()) && tripDate >= oneWeekAgo;
                    }

                    return matchesSearch && matchesPilot && matchesStatus && matchesDate && matchesTimeRange;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="empty-state" style={{ textAlign: 'center', color: 'var(--muted)', padding: '48px 24px', backgroundColor: 'var(--surface-soft)', borderRadius: '12px', border: '1px solid var(--line)' }}>
                        <p style={{ fontSize: '1rem', fontWeight: 600, color: isDark ? '#f8fafc' : '#0f172a', margin: '8px 0' }}>
                          {activityTimeRange === 'week'
                            ? 'No se encontraron viajes en los últimos 7 días con los filtros actuales'
                            : 'No se encontraron registros de viajes en el historial'}
                        </p>
                        {activityTimeRange === 'week' && (
                          <button
                            type="button"
                            onClick={() => setActivityTimeRange('all')}
                            style={{
                              backgroundColor: 'var(--accent)',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '10px',
                              padding: '8px 16px',
                              fontSize: '0.84rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              marginTop: '8px',
                              boxShadow: '0 7px 18px var(--accent-shadow)'
                            }}
                          >
                            Ver Todo el Historial Anterior
                          </button>
                        )}
                      </div>
                    );
                  }

                  return (
                    <>
                      {filtered.map((trip) => {
                        const isEnCurso = trip.estadoViaje === 'En Curso';
                        const isCancelado = trip.estadoViaje === 'Cancelado';
                        const dateObj = new Date(trip.fechaInicio);
                        const formattedDate = dateObj.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' });
                        const formattedTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                        return (
                          <div
                            className="trip-history-card"
                            key={trip.idViaje}
                            onClick={() => {
                              setSelectedTripDetail(trip);
                              setShowTripDetailModal(true);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: 'var(--surface)',
                              border: '1px solid var(--line)',
                              borderRadius: '12px',
                              padding: '16px 20px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              gap: '16px',
                              flexWrap: 'wrap',
                              boxShadow: 'none'
                            }}
                          >
                            {/* Lado Izquierdo: Ícono de Autobús */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: '240px' }}>
                              <div style={{
                                width: '46px',
                                height: '46px',
                                borderRadius: '12px',
                                backgroundColor: 'var(--accent-soft)',
                                border: '1px solid var(--accent-line)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--accent)',
                                flexShrink: 0
                              }}>
                                <Bus size={22} color="var(--accent)" strokeWidth={2} />
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <strong style={{ color: isDark ? '#f8fafc' : '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                  {trip.nombreRuta && trip.nombreRuta !== 'N/D'
                                    ? trip.nombreRuta
                                    : trip.destinoNombre || 'Ruta sin guardar'}
                                </strong>
                                <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.8rem', fontWeight: 500 }}>
                                  {formattedDate} • {formattedTime}
                                </div>
                                <div style={{ color: isDark ? '#64748b' : '#94a3b8', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span><strong>{trip.placaAutobus}</strong></span>
                                  <span>•</span>
                                  <span>{trip.nombrePiloto}</span>
                                </div>
                              </div>
                            </div>

                            {/* Lado Derecho: Estado y Botón Reagendar / Ver Detalle */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                padding: '4px 10px',
                                borderRadius: '8px',
                                backgroundColor: isEnCurso ? 'var(--accent-soft)' : isCancelado ? (isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2') : (isDark ? 'rgba(5, 150, 105, 0.15)' : '#ecfdf5'),
                                color: isEnCurso ? 'var(--accent)' : isCancelado ? '#ef4444' : (isDark ? '#34d399' : '#059669'),
                                border: `1px solid ${isEnCurso ? 'var(--accent-line)' : isCancelado ? (isDark ? 'rgba(239, 68, 68, 0.3)' : '#fecaca') : (isDark ? 'rgba(5, 150, 105, 0.3)' : '#a7f3d0')}`,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}>
                                {isEnCurso ? (
                                  <>
                                    <Radio size={12} />
                                    <span>En Curso</span>
                                  </>
                                ) : isCancelado ? (
                                  <>
                                    <AlertTriangle size={12} />
                                    <span>Cancelado</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 size={12} />
                                    <span>Completado</span>
                                  </>
                                )}
                              </span>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveLiveRoutePlaca(trip.placaAutobus);
                                  setFocusedBusPlaca(trip.placaAutobus);
                                  setActiveTab('map');
                                }}
                                style={{
                                  backgroundColor: 'var(--accent-soft)',
                                  color: 'var(--accent)',
                                  border: '1px solid var(--accent-line)',
                                  borderRadius: '10px',
                                  padding: '7px 14px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = 'var(--accent-soft)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'var(--accent-soft)';
                                }}
                              >
                                <Navigation size={14} />
                                <span>Ver Ruta</span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTripDetail(trip);
                                  setShowTripDetailModal(true);
                                }}
                                style={{
                                  backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                                  color: isDark ? '#f8fafc' : '#0f172a',
                                  border: `1.5px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                                  borderRadius: '10px',
                                  padding: '7px 14px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f1f5f9';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = isDark ? '#1f2937' : '#f8fafc';
                                }}
                              >
                                Ver Detalle
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Botón inferior para ver todo si está en modo semana */}
                      {activityTimeRange === 'week' && (
                        <div className="history-more" style={{ textAlign: 'center', marginTop: '12px', padding: '12px' }}>
                          <button
                            type="button"
                            onClick={() => setActivityTimeRange('all')}
                            style={{
                              backgroundColor: isDark ? '#111827' : '#ffffff',
                              color: 'var(--accent)',
                              border: `1.5px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                              borderRadius: '12px',
                              padding: '10px 22px',
                              fontSize: '0.84rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '8px',
                              transition: 'all 0.15s ease',
                              boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.02)'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'var(--accent-soft)';
                              e.currentTarget.style.borderColor = 'var(--accent-line)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = isDark ? '#111827' : '#ffffff';
                              e.currentTarget.style.borderColor = isDark ? '#374151' : '#e2e8f0';
                            }}
                          >
                            Ver todo el historial completo <ChevronDown size={15} />
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL "DETALLES DEL VIAJE" */}
      {showTripDetailModal && selectedTripDetail && (
        <div className="modal-overlay" style={modalOverlayStyle}>
          <div className="modal-card" role="dialog" aria-modal="true" style={{
            ...modalCardStyle,
            maxWidth: '560px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: '16px',
            padding: '0',
            overflow: 'hidden',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-modal)'
          }}>
            {/* Header con botón de cerrar */}
            <div className="trip-detail-header" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '18px 24px',
              borderBottom: `1px solid ${isDark ? '#1f2937' : '#f1f5f9'}`
            }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: isDark ? '#f8fafc' : '#0f172a' }}>
                Detalles del Viaje
              </h3>
              <button
                onClick={() => setShowTripDetailModal(false)}
                style={{
                  background: isDark ? '#1f2937' : '#f1f5f9',
                  border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                  borderRadius: '8px',
                  color: isDark ? '#cbd5e1' : '#64748b',
                  fontSize: '16px',
                  cursor: 'pointer',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700
                }}
              >
                <X size={17} />
              </button>
            </div>

            {/* Contenido Scrollable */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* Encabezado del Viaje con Avatar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: isDark ? '#f8fafc' : '#0f172a', lineHeight: 1.2 }}>
                    Viaje con {selectedTripDetail.nombrePiloto}
                  </h2>
                  <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.85rem', marginTop: '4px', fontWeight: 500 }}>
                    {new Date(selectedTripDetail.fechaInicio).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })} {new Date(selectedTripDetail.fechaInicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Placa: {selectedTripDetail.placaAutobus}
                  </div>
                </div>

                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '14px',
                  backgroundColor: 'var(--accent-soft)',
                  border: '1px solid var(--accent-line)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent)',
                  flexShrink: 0
                }}>
                  <Bus size={24} color="var(--accent)" strokeWidth={2} />
                </div>
              </div>

              {/* Botón Principal de Ver Ruta HASTA ARRIBA */}
              <button
                type="button"
                onClick={() => {
                  setShowTripDetailModal(false);
                  setActiveLiveRoutePlaca(selectedTripDetail.placaAutobus);
                  setFocusedBusPlaca(selectedTripDetail.placaAutobus);
                  setActiveTab('map');
                }}
                style={{
                  backgroundColor: 'var(--accent)',
                  backgroundImage: 'none',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 18px',
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 9px 22px var(--accent-shadow)',
                  transition: 'all 0.15s ease',
                  width: '100%'
                }}
              >
                <Navigation size={18} />
                <span>Ver Ruta en el Mapa</span>
              </button>

              {canManageOperations
                && !selectedTripDetail.idRuta
                && selectedTripDetail.destinoLatitud != null
                && selectedTripDetail.destinoLongitud != null && (
                <button
                  type="button"
                  onClick={() => openSaveTripAsRouteModal(selectedTripDetail)}
                  style={{
                    ...cancelButtonStyle,
                    width: '100%',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                    borderColor: 'var(--accent-line)',
                    background: 'var(--accent-soft)',
                    padding: '11px 16px',
                  }}
                >
                  <BookmarkPlus size={17} /> Guardar como ruta frecuente
                </button>
              )}

              {canManageOperations && selectedTripDetail.estadoViaje === 'En Curso' && (
                <div style={{
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  border: '1px solid var(--accent-line)',
                  borderRadius: '14px',
                  background: 'var(--accent-soft)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div>
                      <strong style={{ color: isDark ? '#f8fafc' : '#172429', fontSize: '0.88rem' }}>Seguimiento para pasajeros</strong>
                      <p style={{ margin: '4px 0 0', color: isDark ? '#94a3b8' : '#66777d', fontSize: '0.76rem', lineHeight: 1.45 }}>
                        Compartir reutiliza el enlace vigente. Rotar invalida el anterior y conserva el historial interno.
                      </p>
                    </div>
                    <QrCode size={21} color="var(--accent)" />
                  </div>
                  <button type="button" onClick={() => void createPublicTripLink(selectedTripDetail, true)} disabled={creatingPublicLink}>Rotar enlace</button>
                  {!publicTripLink ? (
                    <button
                      type="button"
                      onClick={() => void createPublicTripLink(selectedTripDetail)}
                      disabled={creatingPublicLink}
                      style={{ ...saveButtonStyle, justifyContent: 'center', width: '100%', opacity: creatingPublicLink ? 0.65 : 1 }}
                    >
                      <QrCode size={16} /> {creatingPublicLink ? 'Generando acceso...' : 'Generar enlace y QR'}
                    </button>
                  ) : (
                    <div className="public-link-grid" style={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: '12px', alignItems: 'center' }}>
                      {publicTripQr && <img src={publicTripQr} alt="Código QR del viaje" style={{ width: '112px', height: '112px', padding: '6px', borderRadius: '12px', background: '#fff' }} />}
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input
                          aria-label="Enlace público del viaje"
                          readOnly
                          value={publicTripLink}
                          onFocus={(event) => event.currentTarget.select()}
                          style={{ ...formInputStyle, width: '100%', fontSize: '0.72rem', padding: '9px 10px' }}
                        />
                        <div className="public-link-actions" style={{ display: 'flex', gap: '7px' }}>
                          <button type="button" onClick={() => void copyPublicTripLink()} style={{ ...cancelButtonStyle, flex: 1, justifyContent: 'center' }}><Copy size={14} /> Copiar</button>
                          <button type="button" onClick={() => window.open(publicTripLink, '_blank', 'noopener,noreferrer')} style={{ ...saveButtonStyle, flex: 1, justifyContent: 'center' }}><ExternalLink size={14} /> Abrir</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Puntos de Origen y Destino */}
              <div style={{
                backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                borderRadius: '14px',
                padding: '16px',
                border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {/* Origen */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--accent)',
                    marginTop: '5px',
                    flexShrink: 0
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: isDark ? '#f8fafc' : '#0f172a', fontSize: '0.9rem', fontWeight: 700 }}>
                      Origen: {selectedTripDetail.origenRuta || 'Punto de salida'}
                    </div>
                    <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.78rem', marginTop: '2px' }}>
                      Salida programada • {new Date(selectedTripDetail.fechaInicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>

                {/* Línea divisoria */}
                <div style={{ width: '2px', height: '12px', backgroundColor: isDark ? '#374151' : '#cbd5e1', marginLeft: '4px' }} />

                {/* Destino */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '2px',
                    backgroundColor: '#ef4444',
                    marginTop: '5px',
                    flexShrink: 0
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: isDark ? '#f8fafc' : '#0f172a', fontSize: '0.9rem', fontWeight: 700 }}>
                      Destino: {selectedTripDetail.destinoRuta || selectedTripDetail.destinoNombre || 'Destino por confirmar'}
                    </div>
                    <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.78rem', marginTop: '2px' }}>
                      {selectedTripDetail.fechaFin
                        ? `Llegada registrada • ${new Date(selectedTripDetail.fechaFin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'Recorrido en progreso (En Ruta)'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Registro de Seguridad y Alertas */}
              <div style={{
                backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                borderRadius: '14px',
                padding: '16px',
                border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: isDark ? '#f8fafc' : '#0f172a', fontSize: '0.88rem' }}>Seguridad y Telemetría</strong>
                  <span style={{ fontSize: '0.76rem', color: isDark ? '#34d399' : '#059669', fontWeight: 700, backgroundColor: isDark ? 'rgba(5, 150, 105, 0.15)' : '#ecfdf5', padding: '2px 8px', borderRadius: '6px' }}>
                    Estado: {selectedTripDetail.estadoViaje}
                  </span>
                </div>
                {historicalAlerts.filter(a => a.idViaje === selectedTripDetail.idViaje).length === 0 ? (
                  <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.82rem', marginTop: '4px' }}>
                    <strong>Conducción Segura:</strong> No se detectaron infracciones de velocidad ni maniobras bruscas durante este recorrido.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                    {historicalAlerts.filter(a => a.idViaje === selectedTripDetail.idViaje).map((alt) => (
                      <div key={alt.idAlerta} style={{ backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2', border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.3)' : '#fecaca'}`, borderRadius: '8px', padding: '8px 10px', fontSize: '0.8rem', color: '#ef4444' }}>
                        <strong>{alt.tipoAlerta}:</strong> {alt.valorRegistrado} registrado a las {new Date(alt.fechaHora).toLocaleTimeString()}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Botones de Acción */}
              <div className="trip-detail-actions" style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowTripDetailModal(false);
                    setActiveTab('map');
                  }}
                  style={{
                    ...saveButtonStyle,
                    flex: 1,
                    backgroundColor: 'var(--accent)',
                    padding: '11px',
                    fontSize: '0.88rem',
                    fontWeight: 600
                  }}
                >
                  Ver en Mapa en Vivo
                </button>
                <button
                  type="button"
                  onClick={() => setShowTripDetailModal(false)}
                  style={{
                    ...cancelButtonStyle,
                    padding: '11px 20px',
                    fontSize: '0.88rem'
                  }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VISTA DE CHAT OPERATIVO EN TIEMPO REAL - CANAL GENERAL Y PRIVADO */}
      {activeTab === 'chat' && (
        <div className="dashboard-view chat-view" style={{ display: 'flex', gap: '20px', width: '100%', height: 'calc(100vh - 220px)', minHeight: '600px' }}>
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
                    color: chatMode === 'general' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
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
                    color: chatMode === 'private' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
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
                  <span>Piloto y despacho</span>
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
                    color: isDark ? '#94a3b8' : '#64748b',
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
                    <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.74rem', marginTop: '2px' }}>Toda la Flota Sincronizada</div>
                  </div>

                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '8px' }}>
                    Pilotos en Turno ({users.filter(u => u.tipoRol === 'Piloto').length})
                  </div>
                  {users.filter(u => u.tipoRol === 'Piloto').length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '14px', color: isDark ? '#64748b' : '#94a3b8', fontSize: '0.78rem' }}>
                      Cargando conductores...
                    </div>
                  ) : (
                    users.filter(u => u.tipoRol === 'Piloto').map((pilot) => (
                      <div
                        key={pilot.idUsuario}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '12px',
                          backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                          border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '10px',
                          backgroundColor: isDark ? '#111827' : '#f1f5f9',
                          border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
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
                          <div style={{ color: isDark ? '#f8fafc' : '#0f172a', fontWeight: 600, fontSize: '0.84rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {pilot.nombreCompleto} {pilot.idUsuario === user?.idUsuario && ' (Tú)'}
                          </div>
                          <div style={{ color: pilot.estado === 'Activo' ? (isDark ? '#34d399' : '#059669') : (isDark ? '#64748b' : '#94a3b8'), fontSize: '0.72rem', marginTop: '1px', fontWeight: 500 }}>
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
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                      <div style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.74rem', marginTop: '2px' }}>Línea Confidencial Directa</div>
                    </div>
                  ) : (
                    loadingUsers ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: isDark ? '#64748b' : '#94a3b8', fontSize: '0.8rem' }}>
                        Cargando pilotos...
                      </div>
                    ) : users.filter(u => u.tipoRol === 'Piloto').length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: isDark ? '#64748b' : '#94a3b8', fontSize: '0.8rem' }}>
                        <div>No se encontraron pilotos registrados.</div>
                        <button
                          type="button"
                          onClick={() => fetchUsers()}
                          style={{
                            marginTop: '10px',
                            backgroundColor: isDark ? '#1f2937' : '#ffffff',
                            color: 'var(--accent)',
                            border: `1.5px solid ${isDark ? '#374151' : '#e2e8f0'}`,
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
                              backgroundColor: isActive ? 'var(--accent-soft)' : (isDark ? '#1f2937' : '#ffffff'),
                              border: `1px solid ${isActive ? 'var(--accent-line)' : (isDark ? '#374151' : '#e2e8f0')}`,
                              color: isDark ? '#f8fafc' : '#0f172a',
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
                              backgroundColor: isActive ? 'var(--accent-soft)' : (isDark ? '#111827' : '#f1f5f9'),
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
                              <div style={{ fontWeight: 600, fontSize: '0.84rem', color: isDark ? '#f8fafc' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {pilot.nombreCompleto}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: pilot.estado === 'Activo' ? (isDark ? '#34d399' : '#059669') : (isDark ? '#64748b' : '#94a3b8'), marginTop: '1px', fontWeight: 500 }}>
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
                <h3 style={{ margin: 0, color: isDark ? '#f8fafc' : '#0f172a', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                  <MessageSquare size={18} color="var(--accent)" />
                  <span>
                    {chatMode === 'general'
                      ? 'Canal General de la Flota'
                      : (user?.tipoRol === 'Piloto' ? 'Piloto y despacho' : `${selectedChatPilotName} y despacho`)}
                  </span>
                </h3>
                <p style={{ margin: '2px 0 0 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.82rem' }}>
                  {chatMode === 'general'
                    ? 'Comunicación abierta y sincronizada entre Administración y todos los Pilotos'
                    : (user?.tipoRol === 'Piloto' ? 'Línea directa y confidencial con el Centro de Control' : 'Conversación privada 1-a-1 con el conductor')}
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
                backgroundColor: isDark ? '#0b0f19' : '#f8fafc'
              }}
            >
              {chatLoading ? (
                <div style={{ margin: 'auto', color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.88rem' }}>Cargando mensajes...</div>
              ) : chatMessages.length === 0 ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: isDark ? '#94a3b8' : '#64748b', fontSize: '0.88rem' }}>
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
                            borderRadius: '11px',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: senderVisual.accent,
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 900,
                            letterSpacing: '0.02em',
                            boxShadow: `0 0 0 3px ${isDark ? '#0b0f19' : '#f8fafc'}`
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
                          backgroundColor: isMine ? 'var(--accent)' : (isDark ? senderVisual.dark : senderVisual.light),
                          border: `1px solid ${isMine ? 'var(--accent)' : senderVisual.accent}`,
                          borderLeftWidth: isMine ? '1px' : '4px',
                          borderRadius: '14px',
                          borderBottomRightRadius: isMine ? '3px' : '14px',
                          borderBottomLeftRadius: isMine ? '14px' : '3px',
                          padding: '10px 16px',
                          color: isMine ? '#ffffff' : (isDark ? '#f8fafc' : '#0f172a'),
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
                        <div style={{ fontSize: '0.9rem', lineHeight: '1.45', wordBreak: 'break-word', color: isMine ? '#ffffff' : (isDark ? '#f8fafc' : '#0f172a') }}>
                          {msg.contenido}
                        </div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          gap: '5px',
                          marginTop: '5px',
                          color: isMine ? 'rgba(255,255,255,0.76)' : (isDark ? '#cbd5e1' : '#64748b'),
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
                            color: isMine ? 'rgba(255,255,255,0.86)' : (isDark ? '#cbd5e1' : '#64748b'),
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
              backgroundColor: isDark ? '#111827' : '#ffffff',
              borderTop: `1px solid ${isDark ? '#1f2937' : '#f1f5f9'}`,
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
                    backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                    color: isDark ? '#cbd5e1' : '#475569',
                    border: `1.5px solid ${isDark ? '#374151' : '#e2e8f0'}`,
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
                    e.currentTarget.style.color = isDark ? '#f8fafc' : '#0f172a';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isDark ? '#1f2937' : '#f8fafc';
                    e.currentTarget.style.color = isDark ? '#cbd5e1' : '#475569';
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
                borderTop: `1px solid ${isDark ? '#1f2937' : '#f1f5f9'}`,
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                backgroundColor: isDark ? '#111827' : '#ffffff',
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
                  backgroundColor: isDark ? '#1f2937' : '#f8fafc',
                  borderColor: isDark ? '#374151' : '#e2e8f0',
                  color: isDark ? '#f8fafc' : '#0f172a',
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
                  backgroundColor: user?.tipoRol !== 'Supervisor' && chatInput.trim() && !chatSending ? 'var(--accent)' : (isDark ? '#374151' : '#cbd5e1'),
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

      {showPassengerInbox && <PassengerInbox readOnly={user?.tipoRol === 'Supervisor'} onClose={() => setShowPassengerInbox(false)} />}

      {/* Menú Contextual Flotante de Click Derecho en Mensajes */}
      {chatContextMenu && chatContextMenu.visible && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(chatContextMenu.y, window.innerHeight - 90),
            left: Math.min(chatContextMenu.x, window.innerWidth - 180),
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            border: `1px solid ${isDark ? '#374151' : '#e2e8f0'}`,
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
              color: '#0f172a',
              padding: '8px 12px',
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '0.82rem',
              fontWeight: 600,
              width: '100%',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
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
