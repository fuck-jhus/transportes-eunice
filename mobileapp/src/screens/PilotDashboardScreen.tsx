import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Share,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { MobileTrackingSnapshot, UserSession } from '../types/telemetry';
import { type AppColors, useAppTheme } from '../theme/AppTheme';
import { exportPendingTelemetry } from '../services/offlineStorage';

interface PilotDashboardProps {
  user: UserSession;
  tracking: MobileTrackingSnapshot;
  onNavigateTab?: (tab: string) => void;
  isPrivacyMode?: boolean;
  onTogglePrivacyMode?: () => void;
  onFinishTrip?: () => Promise<boolean>;
  finishingTrip?: boolean;
}

const phaseMeta = (phase: MobileTrackingSnapshot['phase'], colors: AppColors, sharing: boolean) => {
  if (phase === 'tracking') return { color: colors.success, icon: 'radio' as const,
    label: sharing ? 'Seguimiento del viaje' : 'GPS local activo', state: sharing ? 'COMPARTIENDO' : 'LOCAL' };
  if (phase === 'paused') return { color: colors.warning, icon: 'shield' as const, label: 'Privacidad', state: 'PAUSADO' };
  if (phase === 'offline') return { color: colors.warning, icon: 'wifi-off' as const, label: 'Sin conexión', state: 'SIN CONEXIÓN' };
  if (phase === 'weak') return { color: colors.warning, icon: 'navigation' as const, label: 'Señal débil', state: 'SEÑAL DÉBIL' };
  if (phase === 'stale') return { color: colors.warning, icon: 'clock' as const, label: 'Última ubicación conocida', state: 'SIN LECTURA RECIENTE' };
  if (phase === 'blocked' || phase === 'error') return { color: colors.danger, icon: 'alert-triangle' as const, label: 'Requiere atención', state: 'ATENCIÓN' };
  if (phase === 'locating') return { color: colors.focus, icon: 'loader' as const, label: 'Localizando', state: 'LOCALIZANDO' };
  return { color: colors.subtle, icon: 'clock' as const, label: 'En espera', state: 'EN ESPERA' };
};

const formatTime = (timestamp: number | null) => (
  timestamp
    ? new Date(timestamp).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })
    : 'Pendiente'
);

export const PilotDashboardScreen: React.FC<PilotDashboardProps> = ({
  user,
  tracking,
  onNavigateTab,
  isPrivacyMode = false,
  onTogglePrivacyMode,
  onFinishTrip,
  finishingTrip = false,
}) => {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const compact = width < 620;
  const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);
  const meta = phaseMeta(tracking.phase, colors, Boolean(tracking.assignedTrip && !tracking.queueError && !tracking.sourceConflict
    && tracking.lastSentAt && Date.now() - tracking.lastSentAt < 30_000));
  const trip = tracking.assignedTrip;
  const [finishConfirmationOpen, setFinishConfirmationOpen] = useState(false);

  const confirmFinishTrip = async () => {
    if (!onFinishTrip || finishingTrip) return;
    const finished = await onFinishTrip();
    if (finished) setFinishConfirmationOpen(false);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={[styles.statusIcon, { backgroundColor: `${meta.color}20` }]}>
            {tracking.phase === 'locating'
              ? <ActivityIndicator size="small" color={meta.color} />
              : <Feather name={meta.icon} size={21} color={meta.color} />}
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>ESTADO DEL DISPOSITIVO</Text>
            <Text style={styles.heroTitle}>{meta.label}</Text>
            <Text style={styles.heroSubtitle}>{tracking.statusText}</Text>
          </View>
          <View style={[styles.phasePill, { borderColor: `${meta.color}70`, backgroundColor: `${meta.color}15` }]}>
            <View style={[styles.phaseDot, { backgroundColor: meta.color }]} />
            <Text style={[styles.phasePillText, { color: meta.color }]}>{meta.state}</Text>
          </View>
        </View>

        <View style={styles.heroDivider} />

        <View style={styles.speedRow}>
          <View>
            <Text style={styles.metricLabel}>VELOCIDAD ACTUAL</Text>
            <View style={styles.speedValueRow}>
              <Text style={styles.speedValue}>{tracking.locationFresh === false ? '—' : Math.round(tracking.speedKmh)}</Text>
              <Text style={styles.speedUnit}>km/h</Text>
            </View>
          </View>
          <Pressable style={styles.mapButton} onPress={() => onNavigateTab?.('map')}>
            <Feather name="map" size={18} color={colors.white} />
            <Text style={styles.mapButtonText}>Abrir mapa</Text>
          </Pressable>
        </View>
      </View>

      {trip && !isPrivacyMode && tracking.backgroundStatus !== 'active' && (
        <View style={styles.controlCard}>
          <View style={styles.controlCopy}>
            <Text style={styles.sectionTitle}>{tracking.backgroundStatus === 'starting' ? 'Activando seguimiento en segundo plano' : 'Seguimiento solo con la app abierta'}</Text>
            <Text style={styles.controlDescription}>Para compartir el recorrido al bloquear el teléfono, permite el acceso a ubicación en segundo plano en Ajustes.</Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void Linking.openSettings()}><Text style={styles.retryText}>Abrir Ajustes</Text></Pressable>
        </View>
      )}
      {tracking.queueError && <View accessibilityRole="alert" style={styles.controlCard}>
        <Text style={[styles.controlDescription, { color: colors.danger }]}>{tracking.queueError}</Text>
        <Pressable accessibilityRole="button" style={styles.retryButton} onPress={tracking.retry}><Text style={styles.retryText}>Reintentar envío</Text></Pressable>
        <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void exportPendingTelemetry(user.idUsuario).then(message => Share.share({ title: 'Posiciones pendientes · contiene ubicaciones', message })).catch(() => {})}><Text style={styles.retryText}>Exportar posiciones para revisión</Text></Pressable>
        {tracking.sourceConflict && <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => Alert.alert('Transferir rastreo', 'Este dispositivo reemplazará al GPS que comparte el viaje. Las otras sesiones seguirán disponibles para consulta.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Usar este GPS', onPress: () => void tracking.takeTrackingControl?.() }])}><Text style={styles.retryText}>Tomar control del rastreo</Text></Pressable>}
      </View>}
      <View style={styles.metricsGrid}>
        <MetricCard
          styles={styles}
          colors={colors}
          icon="crosshair"
          label="Precisión GPS"
          value={tracking.accuracy != null ? `${tracking.accuracy} m` : 'Sin lectura'}
          hint={tracking.locationFresh === false ? `Última lectura: ${formatTime(tracking.locationTimestamp ?? null)}` : tracking.accuracy != null && tracking.accuracy <= 30 ? 'Señal óptima' : 'Esperando mayor precisión'}
        />
        <MetricCard
          styles={styles}
          colors={colors}
          icon="database"
          label="Cola sin conexión"
          value={`${tracking.queuedReadings}`}
          hint={tracking.queuedReadings === 0 ? 'Todo sincronizado' : 'Se enviará automáticamente'}
        />
        <MetricCard
          styles={styles}
          colors={colors}
          icon="clock"
          label="Último envío"
          value={formatTime(tracking.lastSentAt)}
          hint="Hora del dispositivo"
        />
        <MetricCard
          styles={styles}
          colors={colors}
          icon="user"
          label="Piloto"
          value={user.nombreCompleto}
          hint={user.usuarioLogin}
        />
      </View>

      <View style={styles.tripCard}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionEyebrow}>ASIGNACIÓN ACTUAL</Text>
            <Text style={styles.sectionTitle}>{trip ? 'Viaje en curso' : 'Sin viaje asignado'}</Text>
          </View>
          <View style={[styles.tripState, trip ? styles.tripStateActive : styles.tripStateIdle]}>
            <Text style={[styles.tripStateText, { color: trip ? colors.success : colors.subtle }]}>
              {trip ? 'ACTIVO' : 'EN ESPERA'}
            </Text>
          </View>
        </View>

        {trip ? (
          <>
            <View style={styles.tripDetails}>
              <View style={styles.busBadge}>
                <MaterialCommunityIcons name="bus" size={24} color={colors.accent} />
              </View>
              <View style={styles.tripMainCopy}>
                <Text style={styles.busPlate}>{trip.placaAutobus}</Text>
                <Text style={styles.routeName}>{trip.nombreRuta || 'Sin ruta predefinida'}</Text>
              </View>
              <View style={styles.tripIdBox}>
                <Text style={styles.tripIdLabel}>VIAJE</Text>
                <Text style={styles.tripIdValue}>#{trip.idViaje}</Text>
              </View>
            </View>
            {onFinishTrip && (
              <Pressable style={styles.finishTripButton} onPress={() => setFinishConfirmationOpen(true)} disabled={finishingTrip}>
                {finishingTrip
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <Feather name="check-circle" size={17} color={colors.white} />}
                <Text style={styles.finishTripButtonText}>{finishingTrip ? 'Finalizando...' : 'Finalizar recorrido y quedar disponible'}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <View style={styles.emptyTrip}>
            <Feather name="calendar" size={24} color={colors.subtle} />
            <Text style={styles.emptyTripText}>Administración debe asignar un viaje antes de iniciar la transmisión.</Text>
          </View>
        )}
      </View>

      <View style={styles.controlCard}>
        <View style={styles.controlCopy}>
          <Text style={styles.sectionEyebrow}>CONTROL DE PRIVACIDAD</Text>
          <Text style={styles.sectionTitle}>{isPrivacyMode ? 'Ubicación pausada' : 'Ubicación habilitada'}</Text>
          <Text style={styles.controlDescription}>
            {isPrivacyMode
              ? 'GPS local y compartición pausados. Las posiciones anteriores pendientes se conservan.'
              : trip ? 'GPS local habilitado. La ubicación se comparte con despacho durante el viaje asignado.' : 'El GPS funciona en este teléfono. Sin viaje asignado, tu ubicación no se comparte con despacho.'}
          </Text>
        </View>
        <Pressable
          style={[styles.privacyButton, isPrivacyMode ? styles.resumeButton : styles.pauseButton]}
          onPress={onTogglePrivacyMode}
          accessibilityRole="button"
          accessibilityLabel={isPrivacyMode ? 'Reanudar GPS local y compartición del viaje asignado' : 'Pausar GPS local y compartición'}
          disabled={!onTogglePrivacyMode}
        >
          <Feather name={isPrivacyMode ? 'play' : 'pause'} size={17} color={isPrivacyMode ? colors.white : colors.warning} />
          <Text style={[styles.privacyButtonText, { color: isPrivacyMode ? colors.white : colors.warning }]}>
            {isPrivacyMode ? 'Reanudar' : 'Pausar'}
          </Text>
        </Pressable>
      </View>

      {(tracking.phase === 'error' || tracking.phase === 'blocked' || tracking.phase === 'weak' || tracking.phase === 'stale') && (
        <Pressable style={styles.retryButton} onPress={tracking.retry}>
          <Feather name="refresh-cw" size={17} color={colors.accent} />
          <Text style={styles.retryText}>Volver a intentar conexión y GPS</Text>
        </Pressable>
      )}

      <Modal visible={finishConfirmationOpen} transparent animationType="fade" onRequestClose={() => !finishingTrip && setFinishConfirmationOpen(false)}>
        <View style={styles.modalLayer}>
          <Pressable style={styles.modalBackdrop} onPress={() => !finishingTrip && setFinishConfirmationOpen(false)} />
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Feather name="check-circle" size={22} color={colors.success} /></View>
            <Text style={styles.confirmTitle}>¿Finalizar este recorrido?</Text>
            <Text style={styles.confirmMessage}>La transmisión GPS se detendrá y quedarás disponible para una nueva asignación.</Text>
            <View style={styles.confirmActions}>
              <Pressable style={styles.confirmCancel} onPress={() => setFinishConfirmationOpen(false)} disabled={finishingTrip}>
                <Text style={styles.confirmCancelText}>Seguir en recorrido</Text>
              </Pressable>
              <Pressable style={styles.confirmFinish} onPress={() => void confirmFinishTrip()} disabled={finishingTrip}>
                <Text style={styles.confirmFinishText}>{finishingTrip ? 'Finalizando...' : 'Finalizar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const MetricCard = ({ styles, colors, icon, label, value, hint }: {
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  value: string;
  hint: string;
}) => (
  <View style={styles.metricCard}>
    <View style={styles.metricIcon}><Feather name={icon} size={17} color={colors.accent} /></View>
    <Text style={styles.metricCardLabel}>{label}</Text>
    <Text style={styles.metricCardValue} numberOfLines={1}>{value}</Text>
    <Text style={styles.metricHint} numberOfLines={1}>{hint}</Text>
  </View>
);

const createStyles = (colors: AppColors, compact: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: compact ? 14 : 22, paddingBottom: 34, gap: 14, maxWidth: 1100, width: '100%', alignSelf: 'center' },
  heroCard: { padding: compact ? 18 : 24, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  heroTopRow: { flexDirection: 'row', alignItems: 'center' },
  statusIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, marginLeft: 13 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 3 },
  heroSubtitle: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginTop: 3 },
  phasePill: { display: compact ? 'none' : 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  phaseDot: { width: 7, height: 7, borderRadius: 4 },
  phasePillText: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },
  heroDivider: { height: 1, backgroundColor: colors.line, marginVertical: 20 },
  speedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  metricLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  speedValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  speedValue: { color: colors.ink, fontSize: compact ? 42 : 52, lineHeight: compact ? 50 : 60, fontWeight: '900', letterSpacing: -2 },
  speedUnit: { color: colors.muted, fontSize: 13, fontWeight: '800', marginLeft: 6 },
  mapButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 15, backgroundColor: colors.accent },
  mapButtonText: { color: colors.white, fontSize: 12, fontWeight: '900' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: compact ? '48%' : '23.7%', minHeight: 138, padding: 15, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  metricIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  metricCardLabel: { color: colors.muted, fontSize: 10.5, fontWeight: '700', marginTop: 13 },
  metricCardValue: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 3 },
  metricHint: { color: colors.subtle, fontSize: 9.5, marginTop: 3 },
  tripCard: { padding: 19, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionEyebrow: { color: colors.muted, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.9 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 4 },
  tripState: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  tripStateActive: { backgroundColor: colors.successSoft },
  tripStateIdle: { backgroundColor: colors.surfaceRaised },
  tripStateText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  tripDetails: { flexDirection: 'row', alignItems: 'center', marginTop: 17, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  busBadge: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  tripMainCopy: { flex: 1, marginLeft: 13 },
  busPlate: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  routeName: { color: colors.muted, fontSize: 11.5, marginTop: 3 },
  tripIdBox: { alignItems: 'flex-end' },
  tripIdLabel: { color: colors.subtle, fontSize: 9, fontWeight: '800' },
  tripIdValue: { color: colors.ink, fontSize: 14, fontWeight: '900', marginTop: 2 },
  finishTripButton: { minHeight: 48, marginTop: 16, borderRadius: 14, backgroundColor: colors.success, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  finishTripButtonText: { color: colors.white, fontSize: 11.5, fontWeight: '900', textAlign: 'center' },
  emptyTrip: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  emptyTripText: { flex: 1, color: colors.muted, fontSize: 11.5, lineHeight: 17 },
  controlCard: { padding: 19, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', gap: 15 },
  controlCopy: { flex: 1 },
  controlDescription: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginTop: 6 },
  privacyButton: { minHeight: 44, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  resumeButton: { backgroundColor: colors.accent },
  pauseButton: { backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warning },
  privacyButtonText: { fontSize: 12, fontWeight: '900' },
  retryButton: { minHeight: 48, borderRadius: 15, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  retryText: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  modalLayer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#020617b8' },
  confirmCard: { width: '100%', maxWidth: 430, borderRadius: 22, padding: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  confirmIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft },
  confirmTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 17 },
  confirmMessage: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 8 },
  confirmActions: { flexDirection: compact ? 'column' : 'row', gap: 9, marginTop: 20 },
  confirmCancel: { flex: 1, minHeight: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  confirmCancelText: { color: colors.ink, fontSize: 11.5, fontWeight: '800' },
  confirmFinish: { flex: 1, minHeight: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  confirmFinishText: { color: colors.white, fontSize: 11.5, fontWeight: '900' },
});
