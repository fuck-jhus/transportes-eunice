import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAppTheme, type AppColors } from '../theme/AppTheme';
import { EmptyState, PrimaryButton, ScreenHeader, ScreenScroll, SurfaceCard } from '../components/MobileUI';
import type { AlertPushTarget } from '../utils/pushNavigation';

interface AlertItem {
  idAlerta: number;
  tipoAlerta: string;
  nombrePiloto: string;
  placaAutobus: string;
  nombreRuta?: string;
  valorRegistrado: number;
  limitePermitido?: number;
  fechaHora: string;
  fechaRecepcion?: string;
  versionRegla?: string;
}

interface EvaluationItem {
  idEvaluacion: number;
  nombrePiloto: string;
  mesAnio: string;
  totalViajes: number;
  puntosRiesgoPor10Horas: number;
  calificacionDesempeno: number | null;
  calidadDatos?: string;
  coberturaPorcentaje?: number;
}

export const AlertsScreen: React.FC<{ openTarget?: AlertPushTarget | null; onPushHandled?: () => void }> = ({ openTarget, onPushHandled } = {}) => {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState<'alerts' | 'ranking'>('alerts');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationItem[]>([]);
  const [stats, setStats] = useState<{ totalAlertas?: number; alertasPorTipo?: Record<string, number>; registrosHistoricos?: number }>({});
  const [period, setPeriod] = useState(() => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guatemala' })));
  const [loadError, setLoadError] = useState(false);
  const [loadedPeriod, setLoadedPeriod] = useState<string | null>(null);
  const sequence = useRef(0);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    const request = ++sequence.current;
    try {
      setLoading(true);
      const params = { anio: period.getFullYear(), mes: period.getMonth() + 1 };
      const [alertsResponse, statsResponse, evaluationsResponse] = await Promise.all([
        api.get<AlertItem[]>('/alertas', { params }),
        api.get<{ totalAlertas?: number; alertasPorTipo?: Record<string, number> }>('/alertas/estadisticas', { params }),
        api.get<EvaluationItem[]>('/evaluaciones', { params }),
      ]);
      if (request !== sequence.current) return;
      setAlerts(Array.isArray(alertsResponse.data) ? alertsResponse.data : []);
      setStats(statsResponse.data || {});
      setLoadError(false);
      setLoadedPeriod(`${params.anio}-${String(params.mes).padStart(2, '0')}`);
      setEvaluations(Array.isArray(evaluationsResponse.data)
        ? [...evaluationsResponse.data].sort((a, b) => Number(b.calificacionDesempeno) - Number(a.calificacionDesempeno))
        : []);
    } catch {
      if (request !== sequence.current) return;
      setLoadError(true);
      showToast('No se pudieron actualizar los indicadores.', 'error', 'Conexión');
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [period]);
  useEffect(() => {
    if (!openTarget) return;
    setTab(openTarget.section);
    const match = openTarget.period?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    setPeriod(match ? new Date(Number(match[1]), Number(match[2]) - 1, 15, 12) : new Date());
    onPushHandled?.();
  }, [openTarget?.requestId]);

  const speedCount = stats.alertasPorTipo?.['Exceso de Velocidad'] ?? 0;
  const brakingCount = stats.alertasPorTipo?.['Frenado Brusco'] ?? 0;

  return (
    <ScreenScroll>
      <ScreenHeader
        title="Alertas y telemetría"
        subtitle="Resumen del mes · listado de hasta 50 alertas recientes"
        action={<PrimaryButton label="Actualizar" icon="refresh-cw" variant="secondary" onPress={() => void fetchData()} />}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <PrimaryButton label="Anterior" variant="secondary" onPress={() => setPeriod(p => new Date(p.getFullYear(), p.getMonth() - 1, 1))} disabled={loading} />
        <Text style={{ color: colors.ink }}>{period.toLocaleDateString('es-GT', { month: 'long', year: 'numeric' })}</Text>
        <PrimaryButton label="Siguiente" variant="secondary" onPress={() => setPeriod(p => new Date(p.getFullYear(), p.getMonth() + 1, 1))} disabled={loading} />
      </View>
      {loadError && <SurfaceCard><Text accessibilityRole="alert" style={{ color: colors.danger }}>No se pudo actualizar este período. {loadedPeriod ? `Los datos conservados corresponden a ${loadedPeriod}.` : 'No hay una consulta confirmada.'}</Text><PrimaryButton label="Volver a consultar" onPress={() => void fetchData()} /></SurfaceCard>}

      <View style={styles.segmented}>
        <SegmentButton colors={colors} styles={styles} active={tab === 'alerts'} icon="alert-triangle" label={`Alertas (${alerts.length})`} onPress={() => setTab('alerts')} />
        <SegmentButton colors={colors} styles={styles} active={tab === 'ranking'} icon="award" label={`Evaluaciones (${evaluations.length})`} onPress={() => setTab('ranking')} />
      </View>

      {tab === 'alerts' && (
        <View style={styles.statsRow}>
          <StatCard styles={styles} colors={colors} label="Total" value={stats.totalAlertas ?? alerts.length} tone={colors.focus} />
          <StatCard styles={styles} colors={colors} label="Velocidad" value={speedCount} tone={colors.danger} />
          <StatCard styles={styles} colors={colors} label="Frenados" value={brakingCount} tone={colors.warning} />
        </View>
      )}
      {tab === 'alerts' && Boolean(stats.registrosHistoricos) && <Text style={{ color: colors.muted }}>{stats.registrosHistoricos} registros históricos por muestra. Las alertas nuevas se agrupan en episodios; no son cifras directamente comparables.</Text>}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : loadError && alerts.length === 0 && evaluations.length === 0 ? null : tab === 'alerts' ? (
        alerts.length === 0 ? (
          <EmptyState icon="shield" title="Sin alertas registradas" message="No hay registros de alertas para este período." />
        ) : (
          <View style={styles.list}>
            {alerts.map((item) => (
              <SurfaceCard key={item.idAlerta} style={styles.alertCard}>
                <View style={styles.alertAccent} />
                <View style={styles.alertHeader}>
                  <View style={styles.alertTitleRow}>
                    <View style={styles.alertIcon}><Feather name="alert-triangle" size={16} color={colors.danger} /></View>
                    <View style={styles.alertTitleCopy}>
                      <Text style={styles.alertType}>{item.tipoAlerta}</Text>
                      <Text style={styles.alertTime}>{new Date(item.fechaHora).toLocaleString('es-GT')}</Text>
                      {item.versionRegla === 'legacy' && <Text style={styles.alertTime}>Registro histórico por muestra</Text>}
                      {item.fechaRecepcion && Math.abs(Date.parse(item.fechaRecepcion) - Date.parse(item.fechaHora)) > 60_000 && <Text style={styles.alertTime}>Recibido: {new Date(item.fechaRecepcion).toLocaleString('es-GT')}</Text>}
                    </View>
                  </View>
                  <View style={styles.valueBadge}><Text style={styles.valueText}>{item.valorRegistrado}</Text></View>
                </View>
                <View style={styles.alertDetails}>
                  <Detail icon="user" value={item.nombrePiloto} colors={colors} styles={styles} />
                  <Detail icon="truck" value={item.placaAutobus} colors={colors} styles={styles} />
                  {item.nombreRuta ? <Detail icon="map-pin" value={item.nombreRuta} colors={colors} styles={styles} /> : null}
                </View>
                {item.limitePermitido != null && (
                  <Text style={styles.limitText}>Límite configurado: {item.limitePermitido}</Text>
                )}
              </SurfaceCard>
            ))}
          </View>
        )
      ) : evaluations.length === 0 ? (
        <EmptyState icon="award" title="Sin evaluaciones consolidadas" message="Procesa una evaluación mensual desde administración para mostrar resultados reales." />
      ) : (
        <View style={styles.list}>
          {evaluations.map((item, index) => {
            const rated = item.calificacionDesempeno != null;
            const score = rated ? Math.max(0, Math.min(100, Number(item.calificacionDesempeno))) : 0;
            const tone = score >= 90 ? colors.success : score >= 75 ? colors.warning : colors.danger;
            return (
              <SurfaceCard key={item.idEvaluacion} style={styles.rankingCard}>
                <View style={styles.rank}><Text style={styles.rankText}>{index + 1}</Text></View>
                <View style={styles.rankingCopy}>
                  <Text style={styles.pilotName}>{item.nombrePiloto}</Text>
                  <Text style={styles.period}>{item.mesAnio} · {item.totalViajes} viajes</Text>
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${score}%`, backgroundColor: tone }]} /></View>
                  <Text style={styles.riskPoints}>{rated ? `${Number(item.puntosRiesgoPor10Horas).toFixed(1)} puntos de riesgo por 10 h` : item.calidadDatos ?? 'Sin cobertura suficiente'} · cobertura {item.coberturaPorcentaje ?? 0}%</Text>
                </View>
                <Text style={[styles.score, { color: rated ? tone : colors.muted }]}>{rated ? score.toFixed(0) : '—'}</Text>
              </SurfaceCard>
            );
          })}
        </View>
      )}
    </ScreenScroll>
  );
};

const SegmentButton = ({ colors, styles, active, icon, label, onPress }: {
  colors: AppColors;
  styles: ReturnType<typeof createStyles>;
  active: boolean;
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
}) => (
  <Pressable style={[styles.segmentButton, active && styles.segmentButtonActive]} onPress={onPress}>
    <Feather name={icon} size={14} color={active ? colors.white : colors.muted} />
    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
  </Pressable>
);

const StatCard = ({ styles, colors, label, value, tone }: { styles: ReturnType<typeof createStyles>; colors: AppColors; label: string; value: number; tone: string }) => (
  <SurfaceCard style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
    <View style={[styles.statLine, { backgroundColor: `${tone}55` }]} />
  </SurfaceCard>
);

const Detail = ({ icon, value, colors, styles }: { icon: React.ComponentProps<typeof Feather>['name']; value: string; colors: AppColors; styles: ReturnType<typeof createStyles> }) => (
  <View style={styles.detail}><Feather name={icon} size={13} color={colors.subtle} /><Text style={styles.detailText}>{value}</Text></View>
);

const createStyles = (colors: AppColors) => StyleSheet.create({
  segmented: { flexDirection: 'row', padding: 4, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: 5 },
  segmentButton: { flex: 1, minHeight: 40, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  segmentButtonActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.muted, fontSize: 10.5, fontWeight: '800' },
  segmentTextActive: { color: colors.white },
  statsRow: { flexDirection: 'row', gap: 9 },
  statCard: { flex: 1, padding: 13 },
  statLabel: { color: colors.muted, fontSize: 9.5, fontWeight: '800' },
  statValue: { fontSize: 24, fontWeight: '900', marginTop: 4 },
  statLine: { height: 3, borderRadius: 2, marginTop: 9 },
  loader: { marginTop: 34 },
  list: { gap: 10 },
  alertCard: { position: 'relative', overflow: 'hidden', paddingLeft: 19 },
  alertAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.danger },
  alertHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  alertTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  alertIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft },
  alertTitleCopy: { flex: 1, marginLeft: 10 },
  alertType: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  alertTime: { color: colors.subtle, fontSize: 9.5, marginTop: 3 },
  valueBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.dangerSoft },
  valueText: { color: colors.danger, fontSize: 11, fontWeight: '900' },
  alertDetails: { marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 7 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  detailText: { color: colors.muted, fontSize: 10.5, fontWeight: '600' },
  limitText: { color: colors.subtle, fontSize: 9.5, marginTop: 10 },
  rankingCard: { flexDirection: 'row', alignItems: 'center' },
  rank: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  rankText: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  rankingCopy: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  pilotName: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  period: { color: colors.muted, fontSize: 9.5, marginTop: 2 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: 'hidden', marginTop: 9 },
  progressFill: { height: '100%', borderRadius: 3 },
  riskPoints: { color: colors.subtle, fontSize: 9, marginTop: 5 },
  score: { fontSize: 20, fontWeight: '900' },
});
