import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ToastProvider, useToast } from './src/context/ToastContext';
import { AppThemeProvider, type AppColors, useAppTheme } from './src/theme/AppTheme';
import { useLiveTelemetryStreamer } from './src/hooks/useLiveTelemetryStreamer';
import { useNavigationSession } from './src/hooks/useNavigationSession';
import type { NavigationTarget } from './src/types/navigation';
import { LoginScreen } from './src/screens/LoginScreen';
import { PilotDashboardScreen } from './src/screens/PilotDashboardScreen';
import { UsersScreen } from './src/screens/UsersScreen';
import { BusesScreen } from './src/screens/BusesScreen';
import { TripsScreen } from './src/screens/TripsScreen';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { LiveMapScreen } from './src/screens/LiveMapScreen';
import { ChatScreen, type ChatOpenTarget } from './src/screens/ChatScreen';
import { RoutesScreen } from './src/screens/RoutesScreen';
import api from './src/api/client';
import { getPushTarget, type TripPushTarget, type AlertPushTarget } from './src/utils/pushNavigation';
import {
  consumeInitialPushResponseAsync,
  maintainPushRegistration,
  isPushForUser,
  subscribeToPushNotifications,
  subscribeToPushResponses,
} from './src/services/pushNotifications';

type TabType = 'map' | 'telemetry' | 'alerts' | 'trips' | 'buses' | 'routes' | 'chat' | 'users';

interface TabDefinition {
  id: TabType;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}

const tabTitles: Record<TabType, { eyebrow: string; title: string }> = {
  map: { eyebrow: 'CENTRO DE CONTROL / EN VIVO', title: 'Monitoreo de unidades' },
  telemetry: { eyebrow: 'DISPOSITIVO DEL PILOTO', title: 'Telemetría móvil' },
  alerts: { eyebrow: 'SEGURIDAD OPERATIVA', title: 'Alertas y reportes' },
  trips: { eyebrow: 'OPERACIÓN DE FLOTA', title: 'Recorridos y despachos' },
  buses: { eyebrow: 'ADMINISTRACIÓN', title: 'Flota de autobuses' },
  routes: { eyebrow: 'OPERACIÓN DE FLOTA', title: 'Rutas guardadas' },
  users: { eyebrow: 'ADMINISTRACIÓN', title: 'Personal y pilotos' },
  chat: { eyebrow: 'COMUNICACIÓN', title: 'Canal operativo' },
};

const allTabs: TabDefinition[] = [
  { id: 'map', label: 'Monitoreo', icon: 'navigation' },
  { id: 'telemetry', label: 'Telemetría', icon: 'activity' },
  { id: 'alerts', label: 'Alertas', icon: 'bar-chart-2' },
  { id: 'trips', label: 'Viajes', icon: 'clipboard' },
  { id: 'buses', label: 'Autobuses', icon: 'truck' },
  { id: 'routes', label: 'Rutas', icon: 'map-pin' },
  { id: 'users', label: 'Personal', icon: 'users' },
  { id: 'chat', label: 'Chat', icon: 'message-square' },
];

const MainNavigator: React.FC = () => {
  const { user, loading, logout, deleteAccount } = useAuth();
  const { showToast } = useToast();
  const { colors, isDark, toggleTheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width >= 900;
  const styles = useMemo(() => createStyles(colors, isDesktop), [colors, isDesktop]);
  const [activeTab, setActiveTab] = useState<TabType>('map');
  const activeTabRef = useRef<TabType>('map');
  const [chatOpenTarget, setChatOpenTarget] = useState<ChatOpenTarget | null>(null);
  const [tripOpenTarget, setTripOpenTarget] = useState<TripPushTarget | null>(null);
  const [alertOpenTarget, setAlertOpenTarget] = useState<AlertPushTarget | null>(null);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountPending, setDeleteAccountPending] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [privacyPreference, setIsPrivacyMode] = useState(false);
  const [privacyLoadedFor, setPrivacyLoadedFor] = useState<number>();
  const isPrivacyMode = privacyPreference || Boolean(user && privacyLoadedFor !== user.idUsuario);
  const [finishingTrip, setFinishingTrip] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const navigation = useNavigationSession(user?.idUsuario, isPrivacyMode);
  const destination = navigation.state.tripActive && navigation.state.assignedTripId ? navigation.state.destination : null;
  const tracking = useLiveTelemetryStreamer(user, destination, Boolean(destination), isPrivacyMode);
  useEffect(() => {
    if (!navigation.ready || !tracking.assignmentConfirmed || !navigation.state.assignedTripId) return;
    if (navigation.state.assignedTripId !== tracking.assignedTrip?.idViaje) {
      navigation.clear();
      showToast('La guía asociada se cerró porque el viaje terminó o cambió de asignación.', 'info', 'Viaje actualizado');
    } else {
      const trip = tracking.assignedTrip;
      const selected = navigation.state.destination;
      if (trip && selected && trip.destinoLatitud != null && trip.destinoLongitud != null
        && (trip.revisionDestino ?? 0) > (navigation.state.assignedTripRevision ?? -1)
        && (Math.abs(selected.lat - trip.destinoLatitud) > 0.0001 || Math.abs(selected.lng - trip.destinoLongitud) > 0.0001)) {
        const place = { id: `trip-${trip.idViaje}`, name: trip.destinoNombre ?? trip.destinoRuta ?? 'Destino actualizado',
          address: trip.destinoNombre ?? 'Destino de despacho', lat: trip.destinoLatitud, lng: trip.destinoLongitud, timestamp: Date.now() };
        navigation.setDestination(place); navigation.bindTrip(trip.idViaje, trip.version, trip.revisionDestino);
        if (tracking.location && tracking.locationFresh) void navigation.calculateRoutes(place, tracking.location);
        showToast('Despacho cambió el destino. Revisa la ruta nueva antes de iniciar la guía.', 'info', 'Destino actualizado');
      }
    }
  }, [navigation.ready, navigation.state.assignedTripId, navigation.state.assignedTripRevision, tracking.assignmentConfirmed, tracking.assignedTrip, navigation.state.destination, navigation.clear, showToast]);
  const lastRerouteAtRef = useRef(0);
  useEffect(() => {
    if (isPrivacyMode || !tracking.location || !tracking.locationTimestamp) return;
    navigation.updateFix({ ...(tracking.displayLocation ?? tracking.location), timestamp: tracking.locationTimestamp,
      accuracy: tracking.accuracy ?? 999, speedKmh: tracking.speedKmh, heading: tracking.heading });
  }, [tracking.location, tracking.displayLocation, tracking.locationTimestamp, tracking.accuracy, tracking.speedKmh, tracking.heading, isPrivacyMode, navigation.updateFix]);
  useEffect(() => {
    if (isPrivacyMode || !navigation.state.tripActive || navigation.state.progress.offRouteCount < 3
      || navigation.state.calculating || !navigation.state.destination || !tracking.location
      || (tracking.accuracy ?? 999) > 35 || Date.now() - lastRerouteAtRef.current < 15_000) return;
    lastRerouteAtRef.current = Date.now();
    void navigation.calculateRoutes(navigation.state.destination, tracking.location);
  }, [isPrivacyMode, navigation.state, navigation.calculateRoutes, tracking.location, tracking.accuracy]);

  const isPilot = user?.tipoRol === 'Piloto';
  const isAdministrator = user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador';
  const isSupervisor = user?.tipoRol === 'Supervisor';

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    AsyncStorage.getItem(`@pilot_privacy_mode_${user.idUsuario}`)
      .then((value) => { if (!cancelled) setIsPrivacyMode(value === 'true'); })
      .catch(() => { if (!cancelled) setIsPrivacyMode(true); })
      .finally(() => { if (!cancelled) setPrivacyLoadedFor(user.idUsuario); });
    return () => { cancelled = true; };
  }, [user?.idUsuario]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const visibleTabs = useMemo(() => allTabs.filter((tab) => {
    if (tab.id === 'telemetry') return isPilot;
    if (tab.id === 'alerts' || tab.id === 'buses') return isAdministrator || isSupervisor;
    if (tab.id === 'users') return isAdministrator;
    return true;
  }), [isAdministrator, isPilot, isSupervisor]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) setActiveTab('map');
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    activeTabRef.current = activeTab;
    if (activeTab === 'chat') setChatUnreadCount(0);
  }, [activeTab]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setChatUnreadCount(0);
    setChatOpenTarget(null);
    setTripOpenTarget(null);
    setAlertOpenTarget(null);
    const navigateFromPush = (data?: Record<string, unknown>) => {
      if (cancelled || !data || !isPushForUser(data, user.idUsuario)) return;
      const target = getPushTarget(data, user);
      if (target) {
        const { tab } = target;
        if (target.chat) setChatOpenTarget(target.chat);
        if (target.trip) setTripOpenTarget(target.trip);
        if (target.alerts) setAlertOpenTarget(target.alerts);
        activeTabRef.current = tab;
        setActiveTab(tab);
        if (tab === 'chat') setChatUnreadCount(0);
        setDrawerOpen(false);
      }
    };

    const stopRegistration = maintainPushRegistration((status) => {
      if (status === 'denied') {
        showToast('Activa las notificaciones de Eunice en Ajustes para recibir mensajes cuando la app esté cerrada.', 'info', 'Notificaciones desactivadas');
      } else if (status === 'error') {
        showToast('No se pudo registrar este dispositivo para avisos push. Puedes seguir usando el chat en tiempo real.', 'error', 'Notificaciones no disponibles');
      }
    });
    const subscription = subscribeToPushResponses((response) => {
      navigateFromPush(response.notification.request.content.data);
    });
    const foregroundSubscription = subscribeToPushNotifications((notification) => {
      if (cancelled) return;
      const data = notification.request.content.data;
      if (!isPushForUser(data, user.idUsuario)) return;
      if (data?.tab === 'chat' && activeTabRef.current !== 'chat') {
        setChatUnreadCount((current) => Math.min(99, current + 1));
      }
    });
    void consumeInitialPushResponseAsync().then((response) => {
      if (response) navigateFromPush(response.notification.request.content.data);
    }).catch(() => {});

    return () => {
      cancelled = true;
      stopRegistration();
      subscription.remove();
      foregroundSubscription.remove();
    };
  }, [showToast, user?.idUsuario, user?.tipoRol]);

  useEffect(() => {
    if (drawerOpen || !logoutPending) return;
    const timer = setTimeout(() => {
      setLogoutPending(false);
      setLogoutOpen(true);
    }, Platform.OS === 'ios' ? 220 : 100);
    return () => clearTimeout(timer);
  }, [drawerOpen, logoutPending]);

  useEffect(() => {
    if (drawerOpen || !deleteAccountPending) return;
    const timer = setTimeout(() => {
      setDeleteAccountPending(false);
      setDeletePassword('');
      setShowDeletePassword(false);
      setDeleteAccountOpen(true);
    }, Platform.OS === 'ios' ? 220 : 100);
    return () => clearTimeout(timer);
  }, [deleteAccountPending, drawerOpen]);

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingMark}><MaterialCommunityIcons name="bus" size={28} color={colors.white} /></View>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingTitle}>Preparando Eunice</Text>
        <Text style={styles.loadingSubtitle}>Validando tu sesión segura</Text>
      </View>
    );
  }

  if (!user) return <LoginScreen />;

  const selectTab = (tab: TabType) => {
    activeTabRef.current = tab;
    setActiveTab(tab);
    if (tab === 'chat') setChatUnreadCount(0);
    setDrawerOpen(false);
  };

  const requestLogout = () => {
    if (isDesktop) {
      setLogoutOpen(true);
      return;
    }

    // Nunca se apilan dos Modal nativos: primero se desmonta el drawer y luego
    // se presenta la confirmación. Esto evita la capa invisible que bloqueaba iOS.
    setLogoutPending(true);
    setDrawerOpen(false);
  };

  const requestDeleteAccount = () => {
    if (isDesktop) {
      setDeletePassword('');
      setShowDeletePassword(false);
      setDeleteAccountOpen(true);
      return;
    }

    setDeleteAccountPending(true);
    setDrawerOpen(false);
  };

  const confirmDeleteAccount = async () => {
    if (!deletePassword.trim() || deletingAccount) return;
    try {
      setDeletingAccount(true);
      await deleteAccount(deletePassword);
      navigation.clear();
      setDeleteAccountOpen(false);
      setDeletePassword('');
      showToast('La cuenta y sus datos personales fueron eliminados.', 'success', 'Cuenta eliminada');
    } catch (error: any) {
      showToast(
        error?.response?.data?.mensaje || 'No se pudo eliminar la cuenta. Revisa la contraseña e inténtalo de nuevo.',
        'error',
        'Eliminación no completada',
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  const togglePrivacy = async () => {
    if (!isPilot) return;
    const next = !isPrivacyMode;
    setIsPrivacyMode(next);
    await AsyncStorage.setItem(`@pilot_privacy_mode_${user.idUsuario}`, String(next)).catch(() => {});
  };

  const finishAssignedTrip = async (): Promise<boolean> => {
    const trip = tracking.assignedTrip;
    if (!user || !trip || finishingTrip) return false;
    try {
      setFinishingTrip(true);
      await api.post(`/viajes/${trip.idViaje}/finalizar`);
      if (navigation.state.assignedTripId === trip.idViaje) navigation.clear();
      tracking.retry();
      showToast('Quedaste disponible para una nueva asignación.', 'success', 'Recorrido finalizado');
      return true;
    } catch (error: any) {
      showToast(error.response?.data?.mensaje || 'No se pudo finalizar el recorrido.', 'error', 'Operación rechazada');
      return false;
    } finally {
      setFinishingTrip(false);
    }
  };

  const openNavigationTarget = (target: NavigationTarget) => {
    const place = { id: target.id, name: target.name, address: target.name, lat: target.lat, lng: target.lng, timestamp: Date.now() };
    navigation.setDestination(place); navigation.bindTrip(target.tripId ?? null, target.tripId ? tracking.assignedTrip?.version : null, target.tripId ? target.tripRevision ?? tracking.assignedTrip?.revisionDestino : null);
    selectTab('map');
    if (tracking.location && tracking.locationFresh) void navigation.calculateRoutes(place, tracking.location);
    else showToast('El destino quedó elegido. Reanuda el GPS para calcular la guía.', 'info', 'Destino preparado');
  };
  const renderScreen = () => {
    switch (activeTab) {
      case 'map': return null;
      case 'telemetry':
        return (
          <PilotDashboardScreen
            user={user}
            tracking={tracking}
            onNavigateTab={(tab) => selectTab(tab as TabType)}
            isPrivacyMode={isPrivacyMode}
            onTogglePrivacyMode={() => void togglePrivacy()}
            onFinishTrip={finishAssignedTrip}
            finishingTrip={finishingTrip}
          />
        );
      case 'alerts': return <AlertsScreen openTarget={alertOpenTarget} onPushHandled={() => setAlertOpenTarget(null)} />;
      case 'trips': return <TripsScreen user={user} openTarget={tripOpenTarget} onPushHandled={() => setTripOpenTarget(null)} onTripChanged={tracking.retry} onNavigate={openNavigationTarget} />;
      case 'buses': return <BusesScreen user={user} />;
      case 'routes': return <RoutesScreen user={user} onNavigate={openNavigationTarget} />;
      case 'users': return <UsersScreen />;
      case 'chat': return <ChatScreen user={user} vehicleMoving={Boolean(tracking.assignedTrip) && tracking.speedKmh > 5} openTarget={chatOpenTarget} />;
      default: return null;
    }
  };

  const navContent = (
    <View style={[
      styles.navContent,
      !isDesktop && { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) },
    ]}>
      <View style={styles.brandBlock}>
        <View style={styles.brandIcon}><MaterialCommunityIcons name="bus" size={22} color={colors.accent} /></View>
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>Eunice</Text>
          <Text style={styles.brandSubtitle}>Operaciones de flota</Text>
        </View>
        {!isDesktop && (
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar menú" style={styles.drawerClose} onPress={() => setDrawerOpen(false)}>
            <Feather name="x" size={20} color={colors.navMuted} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.navList} showsVerticalScrollIndicator={false}>
        <Text style={styles.navSectionLabel}>NAVEGACIÓN</Text>
        {visibleTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} key={tab.id} style={[styles.navItem, active && styles.navItemActive]} onPress={() => selectTab(tab.id)}>
              <Feather name={tab.icon} size={18} color={active ? colors.ink : colors.navMuted} />
              <Text style={[styles.navItemText, active && styles.navItemTextActive]}>{tab.label}</Text>
              {tab.id === 'chat' && chatUnreadCount > 0 && (
                <View style={styles.navUnreadBadge}><Text style={styles.navUnreadText}>{chatUnreadCount > 9 ? '9+' : chatUnreadCount}</Text></View>
              )}
              {active && <View style={styles.navActiveIndicator} />}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.navFooter}>
        <Pressable style={styles.navUtilityButton} onPress={() => void toggleTheme()}>
          <Feather name={isDark ? 'sun' : 'moon'} size={17} color={colors.accent} />
          <Text style={styles.navUtilityText}>{isDark ? 'Modo claro' : 'Modo oscuro'}</Text>
        </Pressable>
        <Pressable style={[styles.navUtilityButton, styles.logoutButton]} onPress={requestLogout}>
          <Feather name="log-out" size={17} color={colors.danger} />
          <Text style={[styles.navUtilityText, { color: colors.danger }]}>Cerrar sesión</Text>
        </Pressable>
        <Pressable style={[styles.navUtilityButton, styles.deleteAccountButton]} onPress={requestDeleteAccount}>
          <Feather name="trash-2" size={17} color={colors.danger} />
          <Text style={[styles.navUtilityText, { color: colors.danger }]}>Eliminar mi cuenta</Text>
        </Pressable>
      </View>
    </View>
  );

  const mobilePrimaryTabs = visibleTabs.slice(0, 3);
  const title = tabTitles[activeTab];

  return (
    <View style={styles.safeArea}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.shell}>
        {isDesktop && <View style={styles.sidebar}>{navContent}</View>}

        <View style={[styles.mainColumn, !isDesktop && { paddingTop: insets.top }]}>
          <View style={styles.header}>
            {!isDesktop && (
              <Pressable accessibilityRole="button" accessibilityLabel="Abrir menú de navegación" style={styles.headerIconButton} onPress={() => setDrawerOpen(true)}>
                <Feather name="menu" size={20} color={colors.ink} />
              </Pressable>
            )}
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>{title.eyebrow}</Text>
              <Text style={styles.headerTitle} numberOfLines={2}>{title.title}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} style={styles.themeHeaderButton} onPress={() => void toggleTheme()}>
              <Feather name={isDark ? 'sun' : 'moon'} size={17} color={colors.accent} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Abrir menú de cuenta de ${user.nombreCompleto}`} style={styles.profileChip} onPress={() => setDrawerOpen(true)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{user.nombreCompleto?.charAt(0).toUpperCase() || 'U'}</Text></View>
              {isDesktop && (
                <View>
                  <Text style={styles.profileName} numberOfLines={1}>{user.nombreCompleto}</Text>
                  <Text style={styles.profileRole}>{user.tipoRol}</Text>
                </View>
              )}
            </Pressable>
          </View>

          {isPilot && (
            <View style={styles.trackingBar}>
              <View style={[styles.trackingIcon, { backgroundColor: tracking.phase === 'tracking' ? colors.successSoft : colors.surfaceRaised }]}>
                <Feather name={tracking.phase === 'tracking' ? 'radio' : tracking.phase === 'paused' ? 'shield' : 'navigation'} size={18} color={tracking.phase === 'tracking' ? colors.success : tracking.phase === 'paused' ? colors.warning : colors.accent} />
              </View>
              <View style={styles.trackingCopy}>
                <Text style={styles.trackingTitle} numberOfLines={2}>{tracking.statusText}</Text>
                <Text style={styles.trackingMeta} numberOfLines={2}>
                  {tracking.assignedTrip ? `${tracking.assignedTrip.placaAutobus} · ${tracking.locationFresh ? tracking.speedKmh.toFixed(0) : '—'} km/h${tracking.backgroundStatus !== 'active' && !isPrivacyMode ? ' · solo con la app abierta' : ''}` : `GPS local · ${tracking.locationFresh ? tracking.speedKmh.toFixed(0) : '—'} km/h · no compartido`}
                  {tracking.queuedReadings > 0 ? ` · ${tracking.queuedReadings} pendientes` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isPrivacyMode ? 'Reanudar GPS y seguimiento del viaje asignado' : 'Pausar GPS y transmisión por privacidad'}
                style={[styles.privacyQuickButton, isPrivacyMode && styles.privacyQuickButtonActive]}
                onPress={() => void togglePrivacy()}
              >
                <Feather name={isPrivacyMode ? 'play' : 'pause'} size={15} color={isPrivacyMode ? colors.white : colors.warning} />
                {!isDesktop ? null : <Text style={[styles.privacyQuickText, isPrivacyMode && { color: colors.white }]}>{isPrivacyMode ? 'Reanudar' : 'Pausar'}</Text>}
              </Pressable>
            </View>
          )}

          <View style={styles.screen}>
            {navigation.ready && <View
          style={[StyleSheet.absoluteFill, { opacity: activeTab === 'map' ? 1 : 0 }]}
              pointerEvents={activeTab === 'map' ? 'auto' : 'none'}
              accessibilityElementsHidden={activeTab !== 'map'}
              importantForAccessibility={activeTab === 'map' ? 'auto' : 'no-hide-descendants'}
            >
              <LiveMapScreen key={user.idUsuario} user={user} navigation={navigation} active={activeTab === 'map'}
                mapTheme={isDark ? 'dark' : 'light'} isPrivacyMode={isPrivacyMode}
                onTogglePrivacyMode={() => void togglePrivacy()} tracking={tracking}
                onFinishAssignedTrip={finishAssignedTrip} finishingTrip={finishingTrip} />
            </View>}
            {activeTab === 'map' && !navigation.ready && <ActivityIndicator color={colors.accent} />}
            {activeTab !== 'map' && renderScreen()}
          </View>

          {!isDesktop && !keyboardVisible && (
            <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 7) }]}>
              {mobilePrimaryTabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} key={tab.id} style={styles.bottomNavItem} onPress={() => selectTab(tab.id)}>
                    <View style={[styles.bottomIconBox, active && styles.bottomIconBoxActive]}>
                      <Feather name={tab.icon} size={19} color={active ? colors.white : colors.muted} />
                    </View>
                    <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>{tab.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable accessibilityRole="button" accessibilityLabel={`Más secciones${chatUnreadCount ? `, ${chatUnreadCount} mensajes sin leer` : ''}`} style={styles.bottomNavItem} onPress={() => setDrawerOpen(true)}>
                <View style={styles.bottomIconBox}>
                  <Feather name="grid" size={19} color={colors.muted} />
                  {chatUnreadCount > 0 && <View style={styles.bottomUnreadBadge}><Text style={styles.navUnreadText}>{chatUnreadCount > 9 ? '9+' : chatUnreadCount}</Text></View>}
                </View>
                <Text style={styles.bottomNavLabel}>Más</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {!isDesktop && (
        <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
          <View style={styles.drawerLayer}>
            <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
            <View style={styles.drawer}>{navContent}</View>
          </View>
        </Modal>
      )}

      <Modal visible={logoutOpen} transparent animationType="fade" onRequestClose={() => setLogoutOpen(false)}>
        <View style={styles.modalLayer}>
          <Pressable style={styles.modalBackdrop} onPress={() => setLogoutOpen(false)} />
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Feather name="log-out" size={21} color={colors.danger} /></View>
            <Text style={styles.confirmTitle}>Cerrar sesión</Text>
            <Text style={styles.confirmMessage}>Se detendrá la transmisión del dispositivo y tendrás que ingresar nuevamente.</Text>
            <View style={styles.confirmActions}>
              <Pressable style={styles.cancelButton} onPress={() => setLogoutOpen(false)}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
              <Pressable style={styles.confirmLogoutButton} onPress={() => { setLogoutOpen(false); navigation.clear(); void logout(); }}>
                <Text style={styles.confirmLogoutText}>Cerrar sesión</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteAccountOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !deletingAccount && setDeleteAccountOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalLayer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => !deletingAccount && setDeleteAccountOpen(false)}
          />
          <ScrollView style={{ maxHeight: '100%', width: '100%', maxWidth: 420 }} contentContainerStyle={styles.confirmCard} keyboardShouldPersistTaps="handled">
            <View style={styles.confirmIcon}><Feather name="trash-2" size={21} color={colors.danger} /></View>
            <Text style={styles.confirmTitle}>Eliminar mi cuenta</Text>
            <Text style={styles.confirmMessage}>
              Esta acción es permanente. Se cerrarán tus recorridos activos, se revocarán las notificaciones y se eliminarán tus datos personales y mensajes. Los registros de seguridad obligatorios se conservarán anonimizados.
            </Text>
            <Text style={styles.deletePasswordLabel}>Confirma tu contraseña</Text>
            <View style={styles.deletePasswordField}>
              <Feather name="lock" size={17} color={colors.muted} />
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                style={styles.deletePasswordInput}
                placeholder="Contraseña actual"
                placeholderTextColor={colors.subtle}
                secureTextEntry={!showDeletePassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                editable={!deletingAccount}
                returnKeyType="done"
                onSubmitEditing={() => void confirmDeleteAccount()}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={showDeletePassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} style={styles.passwordVisibility} onPress={() => setShowDeletePassword((current) => !current)}>
                <Feather name={showDeletePassword ? 'eye-off' : 'eye'} size={18} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.confirmActions}>
              <Pressable
                style={styles.cancelButton}
                disabled={deletingAccount}
                onPress={() => setDeleteAccountOpen(false)}
              >
                <Text style={styles.cancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmLogoutButton, (!deletePassword.trim() || deletingAccount) && styles.actionDisabled]}
                disabled={!deletePassword.trim() || deletingAccount}
                onPress={() => void confirmDeleteAccount()}
              >
                {deletingAccount
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <Text style={styles.confirmLogoutText}>Eliminar definitivamente</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

export default function App() {
  return (
    <AppThemeProvider>
      <SafeAreaProvider>
        <ToastProvider>
          <AuthProvider>
            <MainNavigator />
          </AuthProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </AppThemeProvider>
  );
}

const createStyles = (colors: AppColors, isDesktop: boolean) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  loadingMark: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginBottom: 22 },
  loadingTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 15 },
  loadingSubtitle: { color: colors.muted, fontSize: 11.5, marginTop: 4 },
  sidebar: { width: 242, backgroundColor: colors.nav, borderRightWidth: 1, borderRightColor: colors.line },
  navContent: { flex: 1, backgroundColor: colors.nav },
  brandBlock: { minHeight: 86, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  brandIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  brandCopy: { flex: 1, marginLeft: 11 },
  brandName: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  brandSubtitle: { color: colors.navMuted, fontSize: 10.5, marginTop: 2 },
  drawerClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  navList: { paddingHorizontal: 12, paddingVertical: 18, gap: 5 },
  navSectionLabel: { color: colors.subtle, fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginHorizontal: 10, marginBottom: 7 },
  navItem: { minHeight: 46, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11, position: 'relative' },
  navItemActive: { backgroundColor: colors.navSoft },
  navItemText: { flex: 1, color: colors.navMuted, fontSize: 12, fontWeight: '700' },
  navItemTextActive: { color: colors.ink, fontWeight: '900' },
  navUnreadBadge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger },
  navUnreadText: { color: colors.white, fontSize: 8.5, fontWeight: '900' },
  navActiveIndicator: { position: 'absolute', left: 0, width: 3, height: 22, borderRadius: 2, backgroundColor: colors.accent },
  navFooter: { padding: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  navUtilityButton: { minHeight: 48, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  navUtilityText: { color: colors.navMuted, fontSize: 11.5, fontWeight: '800' },
  logoutButton: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  deleteAccountButton: { backgroundColor: colors.surfaceSoft, borderColor: colors.danger },
  mainColumn: { flex: 1, minWidth: 0 },
  header: { minHeight: isDesktop ? 78 : 68, paddingHorizontal: isDesktop ? 24 : 14, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 10 },
  headerIconButton: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  headerCopy: { flex: 1, minWidth: 0 },
  headerEyebrow: { color: colors.accent, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.8, marginBottom: 3 },
  headerTitle: { color: colors.ink, fontSize: isDesktop ? 21 : 17, fontWeight: '900', letterSpacing: -0.4 },
  themeHeaderButton: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  profileChip: { minHeight: 48, minWidth: 48, maxWidth: 230, borderRadius: 14, paddingHorizontal: 7, paddingRight: isDesktop ? 13 : 7, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  avatar: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  avatarText: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  profileName: { maxWidth: 150, color: colors.ink, fontSize: 11, fontWeight: '900', marginLeft: 9 },
  profileRole: { color: colors.muted, fontSize: 9.5, marginLeft: 9, marginTop: 1 },
  trackingBar: { minHeight: 60, marginHorizontal: isDesktop ? 22 : 12, marginTop: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center' },
  trackingIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  trackingCopy: { flex: 1, minWidth: 0, marginLeft: 10 },
  trackingTitle: { color: colors.ink, fontSize: 11.5, fontWeight: '900' },
  trackingMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  privacyQuickButton: { minWidth: 48, minHeight: 48, borderRadius: 12, paddingHorizontal: isDesktop ? 12 : 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warning },
  privacyQuickButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  privacyQuickText: { color: colors.warning, fontSize: 10.5, fontWeight: '900' },
  screen: { flex: 1, minHeight: 0 },
  bottomNav: { minHeight: 72, paddingHorizontal: 8, paddingTop: 7, flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  bottomNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  bottomIconBox: { width: 36, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  bottomUnreadBadge: { position: 'absolute', right: -7, top: -5, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.surface },
  bottomIconBoxActive: { backgroundColor: colors.accent },
  bottomNavLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  bottomNavLabelActive: { color: colors.accent, fontWeight: '900' },
  drawerLayer: { flex: 1, flexDirection: 'row' },
  drawerBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  drawer: { width: '82%', maxWidth: 320, height: '100%', backgroundColor: colors.nav, shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 30, elevation: 20 },
  modalLayer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#04121cb8' },
  confirmCard: { width: '100%', maxWidth: 420, borderRadius: 22, padding: 23, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  confirmIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft },
  confirmTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 16 },
  confirmMessage: { color: colors.muted, fontSize: 12.5, lineHeight: 19, marginTop: 7 },
  confirmActions: { flexDirection: 'row', gap: 9, marginTop: 22 },
  cancelButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  cancelText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  confirmLogoutButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger },
  confirmLogoutText: { color: colors.white, fontSize: 12, fontWeight: '900' },
  deletePasswordLabel: { color: colors.ink, fontSize: 11.5, fontWeight: '900', marginTop: 18, marginBottom: 7 },
  deletePasswordField: { minHeight: 50, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.lineStrong },
  deletePasswordInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12.5, paddingVertical: 12 },
  passwordVisibility: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  actionDisabled: { opacity: 0.45 },
});
