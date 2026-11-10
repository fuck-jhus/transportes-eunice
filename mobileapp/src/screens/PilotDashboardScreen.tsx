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

  const speed = tracking.locationFresh === false ? null : Math.round(tracking.speedKmh);
  const speedTone = speed == null ? 'idle' : speed > 80 ? 'danger' : speed > 50 ? 'warning' : 'ok';
  const speedColor = speedTone === 'danger' ? colors.danger : speedTone === 'warning' ? colors.warning : speedTone === 'ok' ? colors.success : colors.subtle;
  const speedLabel = speedTone === 'danger' ? 'Exceso de velocidad' : speedTone === 'warning' ? 'Modera la velocidad' : speedTone === 'ok' ? 'Velocidad segura' : 'Sin lectura reciente';
  const speedShare = speed == null ? 0 : Math.min(1, speed / 100);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.ticket}>
        <View style={styles.ticketTop}>
          <View style={styles.ticketBadge}><MaterialCommunityIcons name="bus" size={20} color={'#1e2a24'} /></View>
          <View style={styles.ticketCopy}>
            <Text style={styles.ticketEyebrow}>{trip ? 'VIAJE EN CURSO' : 'SIN VIAJE ASIGNADO'}</Text>
            <Text style={styles.ticketPlate} numberOfLines={1}>{trip ? trip.placaAutobus : user.nombreCompleto}</Text>
          </View>
          {trip ? <Text style={styles.ticketId}>#{trip.idViaje}</Text> : null}
        </View>
        <View style={styles.ticketRoad} />
        <Text style={styles.ticketRoute} numberOfLines={2}>
          {trip ? (trip.nombreRuta || 'Sin ruta predefinida') : 'Administración te asignará un viaje. Mientras tanto tu ubicación no se comparte.'}
        </Text>
      </View>

      <View style={styles.speedCard}>
        <View style={styles.speedHead}>
          <View style={[styles.speedChip, { backgroundColor: `${speedColor}22` }]}>
            <View style={[styles.speedChipDot, { backgroundColor: speedColor }]} />
            <Text style={[styles.speedChipText, { color: speedColor }]}>{speedLabel}</Text>
          </View>
          <View style={styles.gpsChip}>
            {tracking.phase === 'locating'
              ? <ActivityIndicator size="small" color={meta.color} />
              : <Feather name={meta.icon} size={14} color={meta.color} />}
            <Text style={[styles.gpsChipText, { color: meta.color }]} numberOfLines={1}>{meta.label}</Text>
          </View>
        </View>
        <View style={styles.speedValueRow}>
          {speed == null
            ? <Text style={[styles.speedEmpty, { color: colors.subtle }]}>Sin lectura</Text>
            : <Text style={[styles.speedValue, { color: colors.ink }]}>{speed}</Text>}
          {speed != null && <Text style={styles.speedUnit}>km/h</Text>}
        </View>
        <View style={styles.speedTrack}>
          <View style={[styles.speedFill, { width: `${Math.round(speedShare * 100)}%`, backgroundColor: speedColor }]} />
          <View style={[styles.speedMark, { left: '50%' }]} />
          <View style={[styles.speedMark, { left: '80%' }]} />
        </View>
        <View style={styles.speedScale}>
          <Text style={styles.speedScaleText}>0</Text>
          <Text style={[styles.speedScaleText, { position: 'absolute', left: '47%' }]}>50</Text>
          <Text style={[styles.speedScaleText, { position: 'absolute', left: '77%' }]}>80</Text>
          <Text style={styles.speedScaleText}>100</Text>
        </View>
        <Text style={styles.statusLine} numberOfLines={2}>{tracking.statusText}</Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.bigAction, styles.bigActionPrimary, pressed && styles.pressed]} onPress={() => onNavigateTab?.('map')}>
          <Feather name="navigation" size={24} color={colors.onAccent} />
          <Text style={styles.bigActionPrimaryText}>Abrir mapa</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.bigAction, isPrivacyMode ? styles.bigActionResume : styles.bigActionPause, pressed && styles.pressed]}
          onPress={onTogglePrivacyMode}
          accessibilityRole="button"
          accessibilityLabel={isPrivacyMode ? 'Reanudar GPS local y compartición del viaje asignado' : 'Pausar GPS local y compartición'}
          disabled={!onTogglePrivacyMode}
        >
          <Feather name={isPrivacyMode ? 'play' : 'pause'} size={24} color={isPrivacyMode ? colors.onHighlight : colors.warning} />
          <Text style={[styles.bigActionText, { color: isPrivacyMode ? colors.onHighlight : colors.warning }]}>
            {isPrivacyMode ? 'Reanudar ubicación' : 'Pausar ubicación'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.privacyNote}>
        {isPrivacyMode
          ? 'Ubicación pausada. Las posiciones pendientes se conservan y se envían al reanudar.'
          : trip ? 'Tu ubicación se comparte con despacho y con los pasajeros mientras dure el viaje.' : 'El GPS funciona en este teléfono, pero sin viaje no se comparte con nadie.'}
      </Text>

      {trip && !isPrivacyMode && tracking.backgroundStatus !== 'active' && (
        <View style={styles.noticeCard}>
          <Feather name="smartphone" size={18} color={colors.warning} />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>{tracking.backgroundStatus === 'starting' ? 'Activando seguimiento en segundo plano' : 'Seguimiento solo con la app abierta'}</Text>
            <Text style={styles.noticeText}>Para compartir el recorrido con el teléfono bloqueado, permite la ubicación en segundo plano.</Text>
            <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={() => void Linking.openSettings()}><Text style={styles.noticeButtonText}>Abrir Ajustes</Text></Pressable>
          </View>
        </View>
      )}
      {tracking.queueError && <View accessibilityRole="alert" style={[styles.noticeCard, styles.noticeDanger]}>
        <Feather name="alert-triangle" size={18} color={colors.danger} />
        <View style={styles.noticeCopy}>
          <Text style={[styles.noticeTitle, { color: colors.danger }]}>{tracking.queueError}</Text>
          <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={tracking.retry}><Text style={styles.noticeButtonText}>Reintentar envío</Text></Pressable>
          <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={() => void exportPendingTelemetry(user.idUsuario).then(message => Share.share({ title: 'Posiciones pendientes · contiene ubicaciones', message })).catch(() => {})}><Text style={styles.noticeButtonText}>Exportar posiciones para revisión</Text></Pressable>
          {tracking.sourceConflict && <Pressable accessibilityRole="button" style={styles.noticeButton} onPress={() => Alert.alert('Transferir rastreo', 'Este dispositivo reemplazará al GPS que comparte el viaje. Las otras sesiones seguirán disponibles para consulta.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Usar este GPS', onPress: () => void tracking.takeTrackingControl?.() }])}><Text style={styles.noticeButtonText}>Tomar control del rastreo</Text></Pressable>}
        </View>
      </View>}
      {(tracking.phase === 'error' || tracking.phase === 'blocked' || tracking.phase === 'weak' || tracking.phase === 'stale') && (
        <Pressable style={styles.retryButton} onPress={tracking.retry}>
          <Feather name="refresh-cw" size={17} color={colors.accent} />
          <Text style={styles.retryText}>Volver a intentar conexión y GPS</Text>
        </Pressable>
      )}

      <View style={styles.detailsRow}>
        <MetricCard styles={styles} colors={colors} icon="crosshair" label="Precisión"
          value={tracking.accuracy != null ? `${tracking.accuracy} m` : '—'}
          hint={tracking.locationFresh === false ? `Última: ${formatTime(tracking.locationTimestamp ?? null)}` : tracking.accuracy != null && tracking.accuracy <= 30 ? 'Óptima' : 'Esperando'} />
        <MetricCard styles={styles} colors={colors} icon="upload-cloud" label="Último envío"
          value={formatTime(tracking.lastSentAt)} hint={meta.state === 'COMPARTIENDO' ? 'En línea' : meta.state.toLowerCase()} />
        <MetricCard styles={styles} colors={colors} icon="database" label="Pendientes"
          value={`${tracking.queuedReadings}`} hint={tracking.queuedReadings === 0 ? 'Todo enviado' : 'Se enviarán solas'} />
      </View>

      {trip && onFinishTrip && (
        <Pressable style={({ pressed }) => [styles.finishTripButton, pressed && styles.pressed]} onPress={() => setFinishConfirmationOpen(true)} disabled={finishingTrip}>
          {finishingTrip
            ? <ActivityIndicator size="small" color={colors.success} />
            : <Feather name="flag" size={18} color={colors.success} />}
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

const MetricCard = ({ styles, colors, icon, label, value, hint }: {
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  value: string;
  hint: string;
}) => (
  <View style={styles.metricCard}>
    <View style={styles.metricTop}><Feather name={icon} size={13} color={colors.muted} /><Text style={styles.metricCardLabel}>{label}</Text></View>
    <Text style={styles.metricCardValue} numberOfLines={1}>{value}</Text>
    <Text style={styles.metricHint} numberOfLines={1}>{hint}</Text>
  </View>
);

const createStyles = (colors: AppColors, compact: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: compact ? 14 : 22, paddingBottom: 34, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  ticket: { padding: 18, borderRadius: 24, backgroundColor: colors.brand, overflow: 'hidden' },
  ticketTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ticketBadge: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.highlight },
  ticketCopy: { flex: 1, minWidth: 0 },
  ticketEyebrow: { color: '#e8a317', fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1 },
  ticketPlate: { color: '#fffdf8', fontSize: 24, fontWeight: '900', letterSpacing: 0.5, marginTop: 1 },
  ticketId: { color: '#b7d1c4', fontSize: 13, fontWeight: '800' },
  ticketRoad: { height: 0, marginVertical: 14, borderTopWidth: 3, borderStyle: 'dashed', borderColor: '#e8a31799' },
  ticketRoute: { color: '#e9f1ec', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  speedCard: { padding: compact ? 18 : 22, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  speedHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  speedChip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  speedChipDot: { width: 8, height: 8, borderRadius: 4 },
  speedChipText: { fontSize: 11.5, fontWeight: '900' },
  gpsChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  gpsChipText: { fontSize: 11, fontWeight: '800' },
  speedEmpty: { fontSize: compact ? 34 : 40, lineHeight: compact ? 104 : 120, fontWeight: '900' },
  speedValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6 },
  speedValue: { fontSize: compact ? 96 : 112, lineHeight: compact ? 104 : 120, fontWeight: '900', letterSpacing: -4 },
  speedUnit: { color: colors.muted, fontSize: 18, fontWeight: '800', marginLeft: 8 },
  speedTrack: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceRaised, overflow: 'hidden', marginTop: 4 },
  speedFill: { height: '100%', borderRadius: 6 },
  speedMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.surface },
  speedScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  speedScaleText: { color: colors.subtle, fontSize: 10, fontWeight: '700' },
  statusLine: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  actionRow: { flexDirection: 'row', gap: 10 },
  bigAction: { flex: 1, minHeight: 92, borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10 },
  bigActionPrimary: { backgroundColor: colors.accent },
  bigActionPrimaryText: { color: colors.onAccent, fontSize: 15, fontWeight: '900' },
  bigActionPause: { backgroundColor: colors.warningSoft, borderWidth: 1.5, borderColor: colors.warning },
  bigActionResume: { backgroundColor: colors.highlight },
  bigActionText: { fontSize: 15, fontWeight: '900', textAlign: 'center' },
  privacyNote: { color: colors.muted, fontSize: 11.5, lineHeight: 17, paddingHorizontal: 4 },
  noticeCard: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.line },
  noticeDanger: { backgroundColor: colors.dangerSoft },
  noticeCopy: { flex: 1, gap: 6 },
  noticeTitle: { color: colors.ink, fontSize: 13.5, fontWeight: '900' },
  noticeText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  noticeButton: { alignSelf: 'flex-start', minHeight: 38, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  noticeButtonText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  retryButton: { minHeight: 48, borderRadius: 999, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  retryText: { color: colors.accent, fontSize: 12.5, fontWeight: '900' },
  detailsRow: { flexDirection: 'row', gap: 8 },
  metricCard: { flex: 1, minWidth: 0, padding: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricCardLabel: { color: colors.muted, fontSize: 10.5, fontWeight: '700' },
  metricCardValue: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 5 },
  metricHint: { color: colors.subtle, fontSize: 10, marginTop: 2 },
  finishTripButton: { minHeight: 56, marginTop: 4, borderRadius: 999, borderWidth: 1.5, borderColor: colors.success, backgroundColor: colors.successSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  finishTripButtonText: { color: colors.success, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  modalLayer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  confirmCard: { width: '100%', maxWidth: 430, borderRadius: 24, padding: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  confirmIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft },
  confirmTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 17 },
  confirmMessage: { color: colors.muted, fontSize: 12.5, lineHeight: 19, marginTop: 8 },
  confirmActions: { flexDirection: compact ? 'column' : 'row', gap: 9, marginTop: 20 },
  confirmCancel: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  confirmCancelText: { color: colors.ink, fontSize: 12.5, fontWeight: '800' },
  confirmFinish: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  confirmFinishText: { color: colors.onStatus, fontSize: 12.5, fontWeight: '900' },
});
