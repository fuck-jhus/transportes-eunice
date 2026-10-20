import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import api, { getApiOrigin } from '../api/client';
import { ResourceNotice } from '../components/ResourceNotice';
import { useToast } from '../context/ToastContext';
import { useAppTheme, type AppColors } from '../theme/AppTheme';
import type { UserSession, ViajeActivo } from '../types/telemetry';
import type { NavigationTarget } from '../types/navigation';
import { newMessageId as newOperationId } from '../utils/chatIdentity';
import type { TripPushTarget } from '../utils/pushNavigation';
import { ChoiceChip, EmptyState, PrimaryButton, ScreenHeader, ScreenScroll, SurfaceCard, uiStyles } from '../components/MobileUI';

interface TripsScreenProps { user?: UserSession; onTripChanged?: () => void; onNavigate?: (target: NavigationTarget) => void; openTarget?: TripPushTarget | null; onPushHandled?: () => void }
interface OptionItem { idUsuario?: number; idAutobus?: number; idRuta?: number; nombreCompleto?: string; placa?: string; nombreRuta?: string; estado?: string; tipoRol?: string }
interface TripItem extends ViajeActivo { fechaFin?: string }
interface PublicTripAccess { token?: string; activo: boolean; fechaExpiracion?: string; chatHabilitado: boolean }

export const TripsScreen: React.FC<TripsScreenProps> = ({ user, onTripChanged, onNavigate, openTarget, onPushHandled }) => {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const common = useMemo(() => uiStyles(colors), [colors]);
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [pilots, setPilots] = useState<OptionItem[]>([]);
  const [buses, setBuses] = useState<OptionItem[]>([]);
  const [routes, setRoutes] = useState<OptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const [detail, setDetail] = useState<TripItem | null>(null);
  const [selectedPilot, setSelectedPilot] = useState<number | null>(null);
  const [selectedBus, setSelectedBus] = useState<number | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<'week' | 'all'>('week');
  const [publicTripLink, setPublicTripLink] = useState('');
  const [sharingTrip, setSharingTrip] = useState(false);
  const dispatchOperation = useRef<{ signature: string; id: string } | null>(null);
  const dispatchBusy = useRef(false);
  const isPilot = user?.tipoRol === 'Piloto';
  const canDispatch = user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador';

  const fetchData = async () => {
    try {
      setLoading(true);
      const tripsResponse = await api.get<TripItem[]>('/viajes');
      const currentTrips = Array.isArray(tripsResponse.data) ? tripsResponse.data : [];
      setTrips(currentTrips);
      if (canDispatch) {
        const [usersResponse, busesResponse, routesResponse] = await Promise.all([
          api.get<OptionItem[]>('/usuarios'),
          api.get<OptionItem[]>('/autobuses'),
          api.get<OptionItem[]>('/rutas'),
        ]);
        const activePilotIds = new Set(currentTrips.filter((trip) => trip.estadoViaje === 'En Curso').map((trip) => trip.idUsuario));
        const activeBusIds = new Set(currentTrips.filter((trip) => trip.estadoViaje === 'En Curso').map((trip) => trip.idAutobus));
        setPilots((usersResponse.data || []).filter((item) => item.tipoRol === 'Piloto' && item.estado === 'Activo' && !activePilotIds.has(item.idUsuario ?? 0)));
        setBuses((busesResponse.data || []).filter((item) => item.estado === 'Activo' && !activeBusIds.has(item.idAutobus ?? 0)));
        setRoutes(routesResponse.data || []);
      }
      setLoadError(false); setUpdatedAt(Date.now());
    } catch {
      setLoadError(true);
      showToast('No se pudo consultar el historial de viajes.', 'error', 'Conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [canDispatch]);
  useEffect(() => {
    if (!openTarget) return;
    let cancelled = false;
    setTimeRange('all');
    setDetail(null);
    void api.get<TripItem>(`/viajes/${openTarget.tripId}`).then(response => {
      if (!cancelled) { setDetail(response.data); onPushHandled?.(); }
    }).catch(() => {
      if (!cancelled) { showToast('No se pudo abrir el viaje del aviso. Actualiza la lista para volver a comprobarlo.', 'error', 'Viaje no disponible'); onPushHandled?.(); }
    });
    return () => { cancelled = true; };
  }, [openTarget?.requestId, user?.idUsuario]);
  useEffect(() => { setPublicTripLink(''); }, [detail?.idViaje]);

  const dispatchTrip = async () => {
    if (dispatchBusy.current) return;
    if (!selectedPilot || !selectedBus) {
      showToast('Selecciona un piloto y un autobús. La ruta puede definirse durante el recorrido.', 'warning', 'Datos incompletos');
      return;
    }
    const signature = `${selectedPilot}:${selectedBus}:${selectedRoute}`;
    if (dispatchOperation.current?.signature !== signature) dispatchOperation.current = { signature, id: newOperationId() };
    dispatchBusy.current = true;
    try {
      setSaving(true);
      await api.post('/viajes', { idOperacion: dispatchOperation.current.id, idUsuario: selectedPilot, idAutobus: selectedBus, idRuta: selectedRoute || null });
      dispatchOperation.current = null;
      setShowDispatch(false);
      setSelectedPilot(null);
      setSelectedBus(null);
      setSelectedRoute(null);
      await fetchData();
      showToast('Viaje despachado correctamente.', 'success', 'Operación creada');
    } catch (error: any) {
      showToast(error.response?.data?.mensaje || 'No se pudo despachar el viaje.', 'error', 'Operación rechazada');
    } finally {
      dispatchBusy.current = false;
      setSaving(false);
    }
  };

  const finishTrip = async (trip: TripItem) => {
    try {
      setSaving(true);
      await api.post(`/viajes/${trip.idViaje}/finalizar`);
      setDetail(null);
      await fetchData();
      onTripChanged?.();
      showToast('El viaje fue finalizado y la unidad salió del monitoreo.', 'success', 'Viaje finalizado');
    } catch (error: any) {
      showToast(error.response?.data?.mensaje || 'No se pudo finalizar el viaje.', 'error', 'Operación rechazada');
    } finally {
      setSaving(false);
    }
  };

  const shareTrip = async (trip: TripItem, rotate = false) => {
    try {
      setSharingTrip(true);
      const response = await api.post<PublicTripAccess>(`/viajes/${trip.idViaje}/acceso-publico`, { chatHabilitado: true, rotar: rotate });
      if (!response.data.token) throw new Error('El servidor no devolvió el acceso público.');
      const apiBase = String(api.defaults.baseURL || 'https://transporteseunice.com/api');
      const origin = getApiOrigin(apiBase);
      const link = `${origin}/viaje/${response.data.token}`;
      setPublicTripLink(link);
      await Share.share({
        title: `Seguimiento de ${trip.nombreRuta || 'viaje'}`,
        message: `Consulta la ubicación del autobús y comunícate con el conductor desde este enlace:\n${link}`,
        url: link,
      });
    } catch (error: any) {
      showToast(error.response?.data?.mensaje || error.message || 'No se pudo crear el enlace para pasajeros.', 'error', 'Acceso público');
    } finally {
      setSharingTrip(false);
    }
  };

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;
  const visibleTrips = trips
    .filter((trip) => !isPilot || trip.idUsuario === user?.idUsuario)
    .filter((trip) => timeRange === 'all' || new Date(trip.fechaInicio).getTime() >= oneWeekAgo)
    .sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());

  return (
    <ScreenScroll>
      <ResourceNotice error={loadError} updatedAt={updatedAt} onRetry={() => void fetchData()} />
      <ScreenHeader
        title="Recorridos y despachos"
        subtitle={isPilot ? 'Tu historial de viajes asignados' : `${visibleTrips.length} operaciones en el período`}
        action={canDispatch ? <PrimaryButton label={showDispatch ? 'Cerrar' : 'Despachar'} icon={showDispatch ? 'x' : 'send'} onPress={() => setShowDispatch((open) => !open)} variant={showDispatch ? 'secondary' : 'primary'} /> : undefined}
      />

      <View style={styles.filters}>
        <ChoiceChip label="Últimos 7 días" icon="calendar" active={timeRange === 'week'} onPress={() => setTimeRange('week')} />
        <ChoiceChip label="Todo el historial" icon="archive" active={timeRange === 'all'} onPress={() => setTimeRange('all')} />
      </View>

      {showDispatch && canDispatch && (
        <SurfaceCard>
          <Text style={common.sectionEyebrow}>NUEVO DESPACHO</Text>
          <Text style={common.sectionTitle}>Configura la asignación</Text>
          <OptionSection title="Piloto disponible">
            {pilots.map((item) => <ChoiceChip key={item.idUsuario} label={item.nombreCompleto || 'Piloto'} icon="user" active={selectedPilot === item.idUsuario} onPress={() => setSelectedPilot(item.idUsuario || null)} />)}
            {pilots.length === 0 && <Text style={styles.optionEmpty}>No hay pilotos activos y libres.</Text>}
          </OptionSection>
          <OptionSection title="Autobús disponible">
            {buses.map((item) => <ChoiceChip key={item.idAutobus} label={item.placa || 'Autobús'} icon="truck" active={selectedBus === item.idAutobus} onPress={() => setSelectedBus(item.idAutobus || null)} />)}
            {buses.length === 0 && <Text style={styles.optionEmpty}>No hay autobuses activos y libres.</Text>}
          </OptionSection>
          <OptionSection title="Ruta">
            <ChoiceChip label="Definir durante el recorrido" icon="navigation" active={selectedRoute === null} onPress={() => setSelectedRoute(null)} />
            {routes.map((item) => <ChoiceChip key={item.idRuta} label={item.nombreRuta || 'Ruta'} icon="map-pin" active={selectedRoute === item.idRuta} onPress={() => setSelectedRoute(item.idRuta || null)} />)}
          </OptionSection>
          <View style={styles.dispatchAction}><PrimaryButton label={saving ? 'Despachando...' : 'Crear viaje'} icon="send" disabled={saving || !selectedPilot || !selectedBus} onPress={() => void dispatchTrip()} /></View>
        </SurfaceCard>
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : visibleTrips.length === 0 && loadError ? null : visibleTrips.length === 0 ? (
        <EmptyState icon="clipboard" title="No hay viajes en este período" message={timeRange === 'week' ? 'Puedes consultar todo el historial o crear un nuevo despacho.' : 'Los viajes aparecerán aquí cuando sean asignados.'} />
      ) : (
        <View style={styles.list}>
          {visibleTrips.map((trip) => {
            const active = trip.estadoViaje === 'En Curso';
            return (
              <Pressable key={trip.idViaje} onPress={() => setDetail(trip)}>
                <SurfaceCard style={styles.tripCard}>
                  <View style={[styles.tripIcon, { backgroundColor: active ? colors.successSoft : colors.surfaceRaised }]}>
                    <MaterialCommunityIcons name="bus" size={22} color={active ? colors.success : colors.muted} />
                  </View>
                  <View style={styles.tripCopy}>
                    <View style={styles.tripTitleRow}>
                      <Text style={styles.route} numberOfLines={1}>{trip.nombreRuta || 'Ruta sin nombre'}</Text>
                      <View style={[styles.stateBadge, { backgroundColor: active ? colors.successSoft : colors.surfaceRaised }]}>
                        <Text style={[styles.stateText, { color: active ? colors.success : colors.muted }]}>{trip.estadoViaje}</Text>
                      </View>
                    </View>
                    <Text style={styles.tripMeta}>{trip.nombrePiloto} · {trip.placaAutobus}</Text>
                    <Text style={styles.tripDate}>{new Date(trip.fechaInicio).toLocaleString('es-GT')}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.subtle} />
                </SurfaceCard>
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal visible={Boolean(detail)} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalLayer}>
          <Pressable style={styles.modalBackdrop} onPress={() => setDetail(null)} />
          {detail && (
            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <View style={styles.detailIcon}><Feather name="map" size={20} color={colors.accent} /></View>
                <View style={styles.detailHeaderCopy}><Text style={styles.detailTitle}>{detail.nombreRuta || 'Detalle del viaje'}</Text><Text style={styles.detailId}>Viaje #{detail.idViaje}</Text></View>
                <Pressable style={styles.closeDetail} onPress={() => setDetail(null)}><Feather name="x" size={19} color={colors.muted} /></Pressable>
              </View>
              <View style={styles.detailRows}>
                <DetailRow styles={styles} colors={colors} icon="user" label="Piloto" value={detail.nombrePiloto} />
                <DetailRow styles={styles} colors={colors} icon="truck" label="Autobús" value={detail.placaAutobus} />
                <DetailRow styles={styles} colors={colors} icon="clock" label="Inicio" value={new Date(detail.fechaInicio).toLocaleString('es-GT')} />
                <DetailRow styles={styles} colors={colors} icon="activity" label="Estado" value={detail.estadoViaje} />
              </View>
              {detail.estadoViaje === 'En Curso' && (
                <View style={styles.detailActions}>
                  {isPilot && detail.idUsuario === user?.idUsuario && detail.destinoLatitud != null && detail.destinoLongitud != null && onNavigate && <PrimaryButton label="Navegar al destino asignado" icon="navigation" onPress={() => { setDetail(null); onNavigate({ id: `trip-${detail.idViaje}`, name: detail.destinoNombre ?? detail.destinoRuta ?? 'Destino asignado', lat: detail.destinoLatitud!, lng: detail.destinoLongitud!, tripId: detail.idViaje, tripRevision: detail.revisionDestino }); }} />}
                  {canDispatch && <PrimaryButton label={sharingTrip ? 'Preparando enlace...' : 'Compartir con pasajeros'} icon="share-2" onPress={() => void shareTrip(detail)} disabled={sharingTrip || saving} variant="secondary" />}
                  {canDispatch && <PrimaryButton label="Rotar enlace" icon="refresh-cw" variant="secondary" disabled={sharingTrip || saving} onPress={() => Alert.alert('Rotar enlace de pasajeros', 'El enlace anterior dejará de funcionar. Las conversaciones seguirán en el historial interno.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Rotar enlace', style: 'destructive', onPress: () => void shareTrip(detail, true) }])} />}
                  {publicTripLink && <Text style={styles.publicLink} numberOfLines={2}>{publicTripLink}</Text>}
                  {(canDispatch || (isPilot && detail.idUsuario === user?.idUsuario)) && <PrimaryButton label={saving ? 'Finalizando...' : 'Finalizar viaje'} icon="check-circle" onPress={() => void finishTrip(detail)} disabled={saving || sharingTrip} variant="danger" />}
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>
    </ScreenScroll>
  );
};

const OptionSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ marginTop: 15 }}><Text style={{ color: '#8a999d', fontSize: 10, fontWeight: '800', marginBottom: 7 }}>{title}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>{children}</ScrollView></View>
);

const DetailRow = ({ styles, colors, icon, label, value }: { styles: ReturnType<typeof createStyles>; colors: AppColors; icon: React.ComponentProps<typeof Feather>['name']; label: string; value: string }) => (
  <View style={styles.detailRow}><View style={styles.detailRowIcon}><Feather name={icon} size={15} color={colors.accent} /></View><View><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View>
);

const createStyles = (colors: AppColors) => StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  dispatchAction: { alignItems: 'flex-end', marginTop: 17 },
  optionEmpty: { color: colors.muted, fontSize: 10.5, fontWeight: '700', paddingVertical: 9 },
  loader: { marginTop: 34 },
  list: { gap: 10 },
  tripCard: { flexDirection: 'row', alignItems: 'center' },
  tripIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tripCopy: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  tripTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  route: { flex: 1, color: colors.ink, fontSize: 13.5, fontWeight: '900' },
  stateBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  stateText: { fontSize: 8.5, fontWeight: '900' },
  tripMeta: { color: colors.muted, fontSize: 10.5, marginTop: 4 },
  tripDate: { color: colors.subtle, fontSize: 9.5, marginTop: 4 },
  modalLayer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: '#04121cba' } as any,
  detailCard: { width: '100%', maxWidth: 460, borderRadius: 22, padding: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  detailHeader: { flexDirection: 'row', alignItems: 'center' },
  detailIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  detailHeaderCopy: { flex: 1, marginLeft: 11 },
  detailTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  detailId: { color: colors.muted, fontSize: 10, marginTop: 2 },
  closeDetail: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  detailRows: { paddingVertical: 17, marginVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, gap: 13 },
  detailRow: { flexDirection: 'row', alignItems: 'center' },
  detailRowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, marginRight: 10 },
  detailLabel: { color: colors.subtle, fontSize: 9.5, fontWeight: '800' },
  detailValue: { color: colors.ink, fontSize: 11.5, fontWeight: '800', marginTop: 2 },
  detailActions: { gap: 10 },
  publicLink: { color: colors.accent, fontSize: 9.5, lineHeight: 14, textAlign: 'center' },
});
