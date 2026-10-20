import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { ResourceNotice } from '../components/ResourceNotice';
import { useToast } from '../context/ToastContext';
import { useAppTheme, type AppColors } from '../theme/AppTheme';
import { AppTextField, EmptyState, PrimaryButton, ScreenHeader, ScreenScroll, SurfaceCard, uiStyles } from '../components/MobileUI';
import type { UserSession } from '../types/telemetry';

interface BusItem {
  idAutobus: number;
  placa: string;
  marcaModelo?: string;
  estado: string;
  nombrePiloto?: string;
  idViajeActivo?: number | null;
  disponibilidad?: string;
}

export const BusesScreen: React.FC<{ user?: UserSession }> = ({ user }) => {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const common = useMemo(() => uiStyles(colors), [colors]);
  const [buses, setBuses] = useState<BusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const canManage = user?.tipoRol === 'Administrador' || user?.tipoRol === 'SuperAdministrador';

  const fetchBuses = async () => {
    try {
      setLoading(true);
      const response = await api.get<BusItem[]>('/autobuses');
      setBuses(Array.isArray(response.data) ? response.data : []);
      setLoadError(false); setUpdatedAt(Date.now());
    } catch {
      setLoadError(true);
      showToast('No se pudo consultar la flota.', 'error', 'Conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchBuses(); }, []);

  const saveBus = async () => {
    if (!canManage) return;
    if (!plate.trim()) {
      showToast('La placa es requerida.', 'warning', 'Datos incompletos');
      return;
    }
    try {
      setSaving(true);
      await api.post('/autobuses', {
        placa: plate.trim().toUpperCase(),
        marcaModelo: `${brand.trim()} ${model.trim()}`.trim() || null,
        estado: 'Activo',
      });
      setPlate('');
      setBrand('');
      setModel('');
      setShowForm(false);
      await fetchBuses();
      showToast('El autobús quedó registrado.', 'success', 'Flota actualizada');
    } catch (error: any) {
      showToast(error.response?.data?.mensaje || 'No se pudo registrar el autobús.', 'error', 'Operación rechazada');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <ResourceNotice error={loadError} updatedAt={updatedAt} onRetry={() => void fetchBuses()} />
      <ScreenHeader
        title="Flota de autobuses"
        subtitle={canManage
          ? `${buses.length} ${buses.length === 1 ? 'unidad registrada' : 'unidades registradas'}`
          : `${buses.length} unidades · consulta de solo lectura`}
        action={canManage ? <PrimaryButton label={showForm ? 'Cerrar' : 'Agregar'} icon={showForm ? 'x' : 'plus'} onPress={() => setShowForm((open) => !open)} variant={showForm ? 'secondary' : 'primary'} /> : undefined}
      />

      {showForm && canManage && (
        <SurfaceCard>
          <Text style={common.sectionEyebrow}>NUEVA UNIDAD</Text>
          <Text style={common.sectionTitle}>Datos del autobús</Text>
          <View style={styles.formGrid}>
            <AppTextField label="Placa" value={plate} onChangeText={setPlate} autoCapitalize="characters" placeholder="C-123ABC" />
            <AppTextField label="Marca" value={brand} onChangeText={setBrand} placeholder="Mercedes-Benz" />
            <AppTextField label="Modelo" value={model} onChangeText={setModel} placeholder="Sprinter 2024" />
          </View>
          <View style={styles.formActions}>
            <PrimaryButton label={saving ? 'Guardando...' : 'Guardar unidad'} icon="save" onPress={() => void saveBus()} disabled={saving} />
          </View>
        </SurfaceCard>
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : buses.length === 0 && loadError ? null : buses.length === 0 ? (
        <EmptyState icon="truck" title="Aún no hay autobuses" message="Registra la primera unidad para comenzar a crear asignaciones y viajes." />
      ) : (
        <View style={styles.list}>
          {buses.map((bus) => (
            <SurfaceCard key={bus.idAutobus} style={styles.busCard}>
              <View style={styles.busIcon}><MaterialCommunityIcons name="bus" size={24} color={colors.accent} /></View>
              <View style={styles.busCopy}>
                <Text style={styles.plate}>{bus.placa}</Text>
                <Text style={styles.model}>{bus.marcaModelo || 'Marca y modelo sin especificar'}</Text>
                <View style={styles.pilotRow}>
                  <Feather name="user" size={12} color={colors.subtle} />
                  <Text style={styles.pilot}>{bus.nombrePiloto || (bus.idViajeActivo === undefined ? 'Asignación no consultada' : 'Sin piloto asignado')}</Text>
                </View>
              </View>
              <View style={[styles.status, { backgroundColor: bus.estado === 'Activo' ? colors.successSoft : colors.surfaceRaised }]}>
                <Text style={[styles.statusText, { color: bus.estado === 'Activo' ? colors.success : colors.muted }]}>{bus.disponibilidad ?? bus.estado}</Text>
              </View>
            </SurfaceCard>
          ))}
        </View>
      )}
    </ScreenScroll>
  );
};

const createStyles = (colors: AppColors) => StyleSheet.create({
  formGrid: { gap: 12, marginTop: 17 },
  formActions: { marginTop: 16, alignItems: 'flex-end' },
  loader: { marginTop: 36 },
  list: { gap: 10 },
  busCard: { flexDirection: 'row', alignItems: 'center' },
  busIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  busCopy: { flex: 1, minWidth: 0, marginLeft: 13 },
  plate: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  model: { color: colors.muted, fontSize: 11.5, marginTop: 3 },
  pilotRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  pilot: { color: colors.subtle, fontSize: 10 },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  statusText: { fontSize: 9.5, fontWeight: '900' },
});
