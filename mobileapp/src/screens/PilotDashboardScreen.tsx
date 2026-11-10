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
import { Feather } from '@expo/vector-icons';
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

  const speed = tracking.locationFresh === false ? null : Math.round(tracking.speedKmh);
  const speedTone = speed == null ? 'idle' : speed > 80 ? 'danger' : speed > 50 ? 'warning' : 'ok';
  const speedColor = speedTone === 'danger' ? colors.danger : speedTone === 'warning' ? colors.warning : speedTone === 'ok' ? colors.success : colors.subtle;
  const speedLabel = speedTone === 'danger' ? 'Exceso de velocidad' : speedTone === 'warning' ? 'Modera la velocidad' : speedTone === 'ok' ? 'Velocidad segura' : 'Sin lectura reciente';
  const speedShare = speed == null ? 0 : Math.min(1, speed / 100);

  const sensorLabel = tracking.sensorState === 'ready' ? 'Listos'
    : tracking.sensorState === 'calibrating' ? 'Calibrando…' : 'No disponibles';
  const sensorHint = tracking.sensorState === 'ready' ? 'Frenado y giros medidos'
    : tracking.sensorState === 'calibrating' ? 'Deja el teléfono fijo unos segundos' : 'Solo se mide la velocidad';
  const statusColor = !trip ? colors.subtle : isPrivacyMode ? colors.warning : meta.color;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.tripHead}>
        <View style={styles.tripStatus}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.tripStatusText}>
            {trip ? `${isPrivacyMode ? 'Ubicación pausada' : 'En curso'} · Viaje #${trip.idViaje}` : 'Sin viaje asignado'}
          </Text>
        </View>
        <Text style={styles.tripPlate} numberOfLines={1}>{trip ? trip.placaAutobus : `Hola, ${user.nombreCompleto.split(' ')[0]}`}</Text>
        <Text style={styles.tripRoute} numberOfLines={2}>
          {trip ? (trip.nombreRuta || 'Sin ruta predefinida') : 'Administración te asignará un viaje. Mientras tanto tu ubicación no se comparte.'}
        </Text>
      </View>

      <View style={styles.speedCard}>
        <View style={styles.speedValueRow}>
          {speed == null
            ? <Text style={[styles.speedEmpty, { color: colors.subtle }]}>Sin lectura</Text>
            : <Text style={[styles.speedValue, { color: speedTone === 'ok' ? colors.ink : speedColor }]}>{speed}</Text>}
        </View>
        <Text style={styles.speedUnit}>{speed == null ? 'Esperando el GPS' : 'km/h'}</Text>
        <View style={styles.speedTrack}>
          <View style={[styles.speedFill, { width: `${Math.round(speedShare * 100)}%`, backgroundColor: speedColor }]} />
          <View style={[styles.speedMark, { left: '50%' }]} />
          <View style={[styles.speedMark, { left: '80%' }]} />
        </View>
        <View style={styles.speedFoot}>
          <Text style={[styles.speedLabel, { color: speedColor }]}>{speedLabel}</Text>
          <View style={styles.gpsChip}>
            {tracking.phase === 'locating'
              ? <ActivityIndicator size="small" color={meta.color} />
              : <Feather name={meta.icon} size={13} color={meta.color} />}
            <Text style={[styles.gpsChipText, { color: meta.color }]} numberOfLines={1}>{meta.label}</Text>
          </View>
        </View>
      </View>

      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]} onPress={() => onNavigateTab?.('map')}>
        <Feather name="navigation" size={20} color={colors.onAccent} />
        <Text style={styles.primaryActionText}>Abrir mapa</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.secondaryAction, isPrivacyMode && styles.secondaryActionActive, pressed && styles.pressed]}
        onPress={onTogglePrivacyMode}
        accessibilityRole="button"
        accessibilityLabel={isPrivacyMode ? 'Reanudar GPS local y compartición del viaje asignado' : 'Pausar GPS local y compartición'}
        disabled={!onTogglePrivacyMode}
      >
        <Feather name={isPrivacyMode ? 'play' : 'pause'} size={18} color={isPrivacyMode ? colors.onHighlight : colors.ink} />
        <Text style={[styles.secondaryActionText, isPrivacyMode && { color: colors.onHighlight }]}>
          {isPrivacyMode ? 'Reanudar ubicación' : 'Pausar ubicación'}
        </Text>
      </Pressable>
      <Text style={styles.privacyNote}>
        {isPrivacyMode
          ? 'Las posiciones pendientes se guardan y se envían al reanudar.'
          : trip ? 'Despacho y los pasajeros ven tu ubicación mientras dure el viaje.' : 'El GPS funciona en este teléfono, pero sin viaje no se comparte.'}
      </Text>

      {trip && !isPrivacyMode && tracking.backgroundStatus !== 'active' && (
        <View style={styles.notice}>
          <Feather name="smartphone" size={18} color={colors.warning} />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>{tracking.backgroundStatus === 'starting' ? 'Activando seguimiento en segundo plano' : 'Solo con la app abierta'}</Text>
            <Text style={styles.noticeText}>Permite la ubicación «siempre» para seguir compartiendo con el teléfono bloqueado.</Text>
            <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={() => void Linking.openSettings()}><Text style={styles.noticeButtonText}>Abrir Ajustes</Text></Pressable>
          </View>
        </View>
      )}
      {tracking.queueError && <View accessibilityRole="alert" style={[styles.notice, styles.noticeDanger]}>
        <Feather name="alert-triangle" size={18} color={colors.danger} />
        <View style={styles.noticeCopy}>
          <Text style={[styles.noticeTitle, { color: colors.danger }]}>{tracking.queueError}</Text>
          <View style={styles.noticeButtons}>
            <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={tracking.retry}><Text style={styles.noticeButtonText}>Reintentar</Text></Pressable>
            <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={() => void exportPendingTelemetry(user.idUsuario).then(message => Share.share({ title: 'Posiciones pendientes · contiene ubicaciones', message })).catch(() => {})}><Text style={styles.noticeButtonText}>Exportar posiciones</Text></Pressable>
            {tracking.sourceConflict && <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={() => Alert.alert('Transferir rastreo', 'Este dispositivo reemplazará al GPS que comparte el viaje. Las otras sesiones seguirán disponibles para consulta.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Usar este GPS', onPress: () => void tracking.takeTrackingControl?.() }])}><Text style={styles.noticeButtonText}>Usar este GPS</Text></Pressable>}
          </View>
        </View>
      </View>}
      {(tracking.phase === 'error' || tracking.phase === 'blocked' || tracking.phase === 'weak' || tracking.phase === 'stale') && (
        <Pressable style={styles.retryButton} onPress={tracking.retry}>
          <Feather name="refresh-cw" size={16} color={colors.accent} />
          <Text style={styles.retryText}>Reintentar GPS y conexión</Text>
        </Pressable>
      )}

      <View style={styles.infoCard}>
        <InfoRow styles={styles} label="Precisión GPS"
          value={tracking.accuracy != null ? `±${tracking.accuracy} m` : '—'}
          hint={tracking.locationFresh === false ? `Última: ${formatTime(tracking.locationTimestamp ?? null)}` : tracking.accuracy != null && tracking.accuracy <= 30 ? 'Buena' : 'Esperando'} />
        <InfoRow styles={styles} label="Último envío" value={formatTime(tracking.lastSentAt)}
          hint={tracking.queuedReadings === 0 ? 'Todo enviado' : `${tracking.queuedReadings} pendientes, se envían solas`} />
        <InfoRow styles={styles} label="Sensores" value={sensorLabel} hint={sensorHint} last />
      </View>

      {trip && onFinishTrip && (
        <Pressable style={({ pressed }) => [styles.finishTripButton, pressed && styles.pressed]} onPress={() => setFinishConfirmationOpen(true)} disabled={finishingTrip}>
          {finishingTrip
            ? <ActivityIndicator size="small" color={colors.ink} />
            : <Feather name="flag" size={17} color={colors.ink} />}
          <Text style={styles.finishTripButtonText}>{finishingTrip ? 'Finalizando…' : 'Llegué: finalizar recorrido'}</Text>
        </Pressable>
      )}

      <Modal visible={finishConfirmationOpen} transparent animationType="fade" onRequestClose={() => !finishingTrip && setFinishConfirmationOpen(false)}>
        <View style={styles.modalLayer}>
          <Pressable style={styles.modalBackdrop} onPress={() => !finishingTrip && setFinishConfirmationOpen(false)} />
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Feather name="flag" size={22} color={colors.success} /></View>
            <Text style={styles.confirmTitle}>¿Finalizar este recorrido?</Text>
            <Text style={styles.confirmMessage}>Se deja de compartir tu ubicación, el enlace de los pasajeros se cierra y quedas disponible para otro viaje.</Text>
            <View style={styles.confirmActions}>
              <Pressable style={styles.confirmCancel} onPress={() => setFinishConfirmationOpen(false)} disabled={finishingTrip}>
                <Text style={styles.confirmCancelText}>Seguir en recorrido</Text>
              </Pressable>
              <Pressable style={styles.confirmFinish} onPress={() => void confirmFinishTrip()} disabled={finishingTrip}>
                <Text style={styles.confirmFinishText}>{finishingTrip ? 'Finalizando…' : 'Finalizar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const InfoRow = ({ styles, label, value, hint, last }: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: string;
  hint: string;
  last?: boolean;
}) => (
  <View style={[styles.infoRow, !last && styles.infoRowDivider]}>
    <View style={styles.infoCopy}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoHint} numberOfLines={1}>{hint}</Text>
    </View>
    <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
  </View>
);

const createStyles = (colors: AppColors, compact: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: compact ? 16 : 24, paddingTop: 8, paddingBottom: 36, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  tripHead: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 8 },
  tripStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  tripStatusText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  tripPlate: { color: colors.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  tripRoute: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 2 },
  speedCard: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 20, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center' },
  speedValueRow: { height: compact ? 100 : 116, justifyContent: 'center' },
  speedValue: { fontSize: compact ? 92 : 108, lineHeight: compact ? 100 : 116, fontWeight: '700', letterSpacing: -3, fontVariant: ['tabular-nums'] },
  speedEmpty: { fontSize: compact ? 30 : 34, fontWeight: '700' },
  speedUnit: { color: colors.muted, fontSize: 15, fontWeight: '600', marginTop: -2 },
  speedTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: colors.surfaceSoft, overflow: 'hidden', marginTop: 20 },
  speedFill: { height: '100%', borderRadius: 3 },
  speedMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.surface },
  speedFoot: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  speedLabel: { fontSize: 13, fontWeight: '700' },
  gpsChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  gpsChipText: { fontSize: 12.5, fontWeight: '600' },
  primaryAction: { minHeight: 58, borderRadius: 29, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 4 },
  primaryActionText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  secondaryAction: { minHeight: 54, borderRadius: 27, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  secondaryActionActive: { backgroundColor: colors.highlight },
  secondaryActionText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  privacyNote: { color: colors.muted, fontSize: 12.5, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12 },
  notice: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.warningSoft },
  noticeDanger: { backgroundColor: colors.dangerSoft },
  noticeCopy: { flex: 1, gap: 4 },
  noticeTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  noticeText: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  noticeButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  noticeButton: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: colors.surface, marginTop: 4 },
  noticeButtonText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  retryButton: { minHeight: 48, borderRadius: 24, backgroundColor: colors.accentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  retryText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  infoCard: { borderRadius: 24, backgroundColor: colors.surface, paddingHorizontal: 18, marginTop: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  infoRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  infoCopy: { flex: 1, minWidth: 0 },
  infoLabel: { color: colors.ink, fontSize: 14.5, fontWeight: '600' },
  infoHint: { color: colors.subtle, fontSize: 12, marginTop: 2 },
  infoValue: { color: colors.ink, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  finishTripButton: { minHeight: 54, marginTop: 6, borderRadius: 27, borderWidth: 1, borderColor: colors.lineStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  finishTripButtonText: { color: colors.ink, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  modalLayer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  confirmCard: { width: '100%', maxWidth: 430, borderRadius: 28, padding: 24, backgroundColor: colors.surface },
  confirmIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft },
  confirmTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 16 },
  confirmMessage: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  confirmActions: { flexDirection: compact ? 'column-reverse' : 'row', gap: 9, marginTop: 22 },
  confirmCancel: { flex: compact ? 0 : 1, minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft },
  confirmCancelText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  confirmFinish: { flex: compact ? 0 : 1, minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  confirmFinishText: { color: colors.onStatus, fontSize: 14, fontWeight: '700' },
});
