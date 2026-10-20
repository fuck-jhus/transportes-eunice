import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { useAppTheme, type AppColors } from '../theme/AppTheme';

export interface TrackingVehiclesFeedProps {
  onSelectBus?: (bus: FleetUnit) => void;
  selectedBusPlaca?: string | null;
  onOpenMap?: () => void;
}

export interface FleetUnit {
  idAutobus?: number;
  idViaje?: number;
  placa?: string;
  placaAutobus?: string;
  nombrePiloto?: string;
  conductor?: string;
  nombreRuta?: string;
  marca?: string;
  modelo?: string;
  estado?: string;
  velocidadKmh?: number;
  latitud?: number;
  longitud?: number;
  fechaInicio?: string;
  fechaHoraDispositivo?: string;
  isPrivacyMode?: boolean;
  isLive?: boolean;
}

const plateOf = (item: FleetUnit) => item.placaAutobus || item.placa || 'Sin placa';
const asArray = (value: unknown): FleetUnit[] => Array.isArray(value) ? value : [];

export const TrackingVehiclesFeed: React.FC<TrackingVehiclesFeedProps> = ({
  onSelectBus,
  selectedBusPlaca,
  onOpenMap,
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [buses, setBuses] = useState<FleetUnit[]>([]);
  const [trips, setTrips] = useState<FleetUnit[]>([]);
  const [liveTelemetry, setLiveTelemetry] = useState<FleetUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabFilter, setTabFilter] = useState<'live' | 'all'>('live');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [busesResult, tripsResult, liveResult] = await Promise.allSettled([
        api.get('/autobuses'),
        api.get('/viajes', { params: { estado: 'En Curso' } }),
        api.get('/telemetria/activas'),
      ]);
      if (busesResult.status === 'fulfilled') setBuses(asArray(busesResult.value.data));
      if (tripsResult.status === 'fulfilled') setTrips(asArray(tripsResult.value.data));
      if (liveResult.status === 'fulfilled') {
        setLiveTelemetry(asArray(liveResult.value.data).map((item) => ({ ...item, isLive: true })));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const timer = setInterval(() => void fetchData(true), 15_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const units = useMemo(() => {
    const byPlate = new Map<string, FleetUnit>();
    buses.forEach((bus) => byPlate.set(plateOf(bus), { ...bus, isLive: false }));
    trips.forEach((trip) => {
      const plate = plateOf(trip);
      byPlate.set(plate, { ...(byPlate.get(plate) ?? {}), ...trip, isLive: false });
    });
    liveTelemetry.forEach((telemetry) => {
      const plate = plateOf(telemetry);
      byPlate.set(plate, { ...(byPlate.get(plate) ?? {}), ...telemetry, isLive: true });
    });
    return Array.from(byPlate.values());
  }, [buses, liveTelemetry, trips]);

  const liveUnits = useMemo(() => units.filter((unit) => unit.isLive), [units]);
  const currentList = tabFilter === 'live' ? liveUnits : units;
  const filteredList = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('es');
    if (!query) return currentList;
    return currentList.filter((item) => [
      plateOf(item), item.nombrePiloto, item.nombreRuta, item.marca, item.modelo,
    ].some((value) => value?.toLocaleLowerCase('es').includes(query)));
  }, [currentList, searchQuery]);

  return (
    <View style={styles.container}>
      <View style={styles.segmentedControl}>
        <Pressable style={[styles.segment, tabFilter === 'live' && styles.segmentActive]} onPress={() => setTabFilter('live')}>
          <Feather name="radio" size={14} color={tabFilter === 'live' ? colors.white : colors.muted} />
          <Text style={[styles.segmentText, tabFilter === 'live' && styles.segmentTextActive]}>En vivo ({liveUnits.length})</Text>
        </Pressable>
        <Pressable style={[styles.segment, tabFilter === 'all' && styles.segmentActive]} onPress={() => setTabFilter('all')}>
          <MaterialCommunityIcons name="bus" size={16} color={tabFilter === 'all' ? colors.white : colors.muted} />
          <Text style={[styles.segmentText, tabFilter === 'all' && styles.segmentTextActive]}>Flota ({units.length})</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar unidad, piloto o ruta"
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={10}>
              <Feather name="x" size={15} color={colors.muted} />
            </Pressable>
          )}
        </View>
        {onOpenMap && (
          <Pressable style={styles.mapButton} onPress={onOpenMap}>
            <Feather name="map" size={16} color={colors.accent} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.stateCopy}>Sincronizando flota</Text>
        </View>
      ) : filteredList.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}><Feather name={tabFilter === 'live' ? 'radio' : 'search'} size={20} color={colors.accent} /></View>
          <Text style={styles.emptyTitle}>{tabFilter === 'live' ? 'No hay unidades transmitiendo' : 'No encontramos coincidencias'}</Text>
          <Text style={styles.emptyCopy}>
            {tabFilter === 'live' ? 'La flota registrada sigue disponible en la pestaña Flota.' : 'Prueba con otra placa, piloto o ruta.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {filteredList.map((item, index) => {
            const plate = plateOf(item);
            const selected = selectedBusPlaca === plate;
            const speed = Number(item.velocidadKmh ?? 0);
            const pilot = item.nombrePiloto || 'Sin piloto en línea';
            const route = item.nombreRuta || [item.marca, item.modelo].filter(Boolean).join(' ') || 'Sin ruta asignada';
            const lastSignal = item.fechaHoraDispositivo
              ? new Date(item.fechaHoraDispositivo).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : null;

            return (
              <Pressable
                key={`${plate}-${item.idViaje ?? item.idAutobus ?? index}`}
                style={({ pressed }) => [styles.vehicleCard, selected && styles.vehicleCardSelected, pressed && styles.pressed]}
                onPress={() => onSelectBus?.(item)}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.busMark}><MaterialCommunityIcons name="bus" size={18} color={colors.accent} /></View>
                  <View style={styles.cardIdentity}>
                    <Text style={styles.plate}>{plate}</Text>
                    <Text style={styles.route} numberOfLines={1}>{route}</Text>
                  </View>
                  <View style={[styles.status, item.isLive ? styles.statusLive : styles.statusIdle]}>
                    <View style={[styles.statusDot, { backgroundColor: item.isLive ? colors.success : colors.muted }]} />
                    <Text style={[styles.statusText, { color: item.isLive ? colors.success : colors.muted }]}>
                      {item.isPrivacyMode ? 'Privacidad' : item.isLive ? 'En vivo' : 'En espera'}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardFooter}>
                  <View style={styles.pilotRow}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{pilot.charAt(0).toUpperCase()}</Text></View>
                    <Text style={styles.pilotName} numberOfLines={1}>{pilot}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{Math.max(0, Math.round(speed))}</Text>
                    <Text style={styles.metricUnit}>km/h</Text>
                  </View>
                  {lastSignal && <Text style={styles.time}>{lastSignal}</Text>}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas, padding: 12 },
  segmentedControl: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 14, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  segment: { flex: 1, minHeight: 38, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  segmentTextActive: { color: colors.white },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  searchBox: { flex: 1, minHeight: 42, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12, paddingVertical: 0 },
  mapButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  centerState: { flex: 1, minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateCopy: { color: colors.muted, fontSize: 11 },
  emptyCard: { marginTop: 12, padding: 24, alignItems: 'center', borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  emptyIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  emptyTitle: { marginTop: 12, color: colors.ink, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  emptyCopy: { marginTop: 5, color: colors.muted, fontSize: 10.5, lineHeight: 16, textAlign: 'center' },
  list: { flex: 1, marginTop: 10 },
  listContent: { gap: 9, paddingBottom: 24 },
  vehicleCard: { padding: 13, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  vehicleCardSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  busMark: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  cardIdentity: { flex: 1, minWidth: 0 },
  plate: { color: colors.ink, fontSize: 12.5, fontWeight: '900' },
  route: { color: colors.muted, fontSize: 9.5, marginTop: 2 },
  status: { minHeight: 25, paddingHorizontal: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1 },
  statusLive: { backgroundColor: colors.successSoft, borderColor: colors.success },
  statusIdle: { backgroundColor: colors.surfaceSoft, borderColor: colors.line },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 8.5, fontWeight: '900' },
  cardFooter: { marginTop: 11, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: colors.line },
  pilotRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  avatar: { width: 25, height: 25, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  avatarText: { color: colors.accent, fontSize: 9.5, fontWeight: '900' },
  pilotName: { flex: 1, color: colors.ink, fontSize: 10.5, fontWeight: '700' },
  metric: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  metricValue: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  metricUnit: { color: colors.muted, fontSize: 8.5 },
  time: { color: colors.muted, fontSize: 9 },
});
