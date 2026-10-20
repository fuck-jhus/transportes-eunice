import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api from '../api/client';
import { ResourceNotice } from '../components/ResourceNotice';
import { AppTextField, EmptyState, PrimaryButton, ScreenHeader, ScreenScroll, SurfaceCard } from '../components/MobileUI';
import { useToast } from '../context/ToastContext';
import { useAppTheme, type AppColors } from '../theme/AppTheme';
import type { UserSession } from '../types/telemetry';
import type { NavigationTarget } from '../types/navigation';

interface RouteItem {
  idRuta: number;
  nombreRuta: string;
  origen: string;
  destino: string;
  destinoLatitud?: number | null;
  destinoLongitud?: number | null;
}

export const RoutesScreen: React.FC<{ user: UserSession; onNavigate?: (target: NavigationTarget) => void }> = ({ user, onNavigate }) => {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const canManage = user.tipoRol === 'Administrador' || user.tipoRol === 'SuperAdministrador';
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [nombreRuta, setNombreRuta] = useState('');
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');

  const fetchRoutes = async () => {
    try {
      setLoading(true);
      const response = await api.get<RouteItem[]>('/rutas');
      setRoutes(Array.isArray(response.data) ? response.data : []);
      setLoadError(false); setUpdatedAt(Date.now());
    } catch (error: any) {
      setLoadError(true);
      showToast(error.response?.data?.mensaje || 'No se pudo consultar el catálogo de rutas.', 'error', 'Conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchRoutes(); }, []);

  const resetForm = () => {
    setNombreRuta('');
    setOrigen('');
    setDestino('');
  };

  const handleSave = async () => {
    const normalizedName = nombreRuta.trim();
    const normalizedOrigin = origen.trim();
    const normalizedDestination = destino.trim();
    if (normalizedName.length < 2 || normalizedOrigin.length < 2 || normalizedDestination.length < 2) {
      showToast('Completa nombre, origen y destino con al menos dos caracteres.', 'warning', 'Datos incompletos');
      return;
    }

    try {
      setSaving(true);
      await api.post('/rutas', {
        nombreRuta: normalizedName,
        origen: normalizedOrigin,
        destino: normalizedDestination,
      });
      resetForm();
      setShowForm(false);
      await fetchRoutes();
      showToast('La ruta quedó disponible para futuros despachos.', 'success', 'Ruta guardada');
    } catch (error: any) {
      showToast(error.response?.data?.mensaje || 'No se pudo guardar la ruta.', 'error', 'Operación rechazada');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      <ResourceNotice error={loadError} updatedAt={updatedAt} onRetry={() => void fetchRoutes()} />
      <ScreenHeader
        title="Rutas guardadas"
        subtitle={canManage ? 'Trayectos reutilizables para despachos rápidos' : 'Catálogo operativo en modo consulta'}
        action={canManage ? (
          <PrimaryButton
            label={showForm ? 'Cerrar' : 'Nueva ruta'}
            icon={showForm ? 'x' : 'plus'}
            variant={showForm ? 'secondary' : 'primary'}
            onPress={() => setShowForm((current) => !current)}
          />
        ) : (
          <PrimaryButton label="Actualizar" icon="refresh-cw" variant="secondary" onPress={() => void fetchRoutes()} />
        )}
      />

      {showForm && canManage && (
        <SurfaceCard style={styles.formCard}>
          <View style={styles.formHeading}>
            <View style={styles.formIcon}><Feather name="map-pin" size={18} color={colors.accent} /></View>
            <View style={styles.formHeadingCopy}>
              <Text style={styles.formTitle}>Guardar trayecto frecuente</Text>
              <Text style={styles.formSubtitle}>Podrás seleccionarlo al despachar una unidad.</Text>
            </View>
          </View>
          <AppTextField label="Nombre de la ruta" value={nombreRuta} onChangeText={setNombreRuta} maxLength={100} placeholder="Ej. Terminal Minerva - Parque Central" />
          <AppTextField label="Origen" value={origen} onChangeText={setOrigen} maxLength={100} placeholder="Ej. Terminal Minerva" />
          <AppTextField label="Destino" value={destino} onChangeText={setDestino} maxLength={100} placeholder="Ej. Parque Central" />
          <View style={styles.formAction}>
            <PrimaryButton label={saving ? 'Guardando...' : 'Guardar ruta'} icon="save" disabled={saving} onPress={() => void handleSave()} />
          </View>
        </SurfaceCard>
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : routes.length === 0 && loadError ? null : routes.length === 0 ? (
        <EmptyState
          icon="map"
          title="Todavía no hay rutas guardadas"
          message={canManage ? 'Crea un trayecto frecuente para usarlo en próximos despachos.' : 'Administración todavía no ha publicado trayectos.'}
        />
      ) : (
        <View style={styles.list}>
          {routes.map((route) => {
            const hasDestination = route.destinoLatitud != null && route.destinoLongitud != null;
            return (
              <SurfaceCard key={route.idRuta} style={styles.routeCard}>
                <View style={styles.routeHeading}>
                  <View style={styles.routeIcon}><Feather name="map" size={19} color={colors.accent} /></View>
                  <View style={styles.routeCopy}>
                    <Text style={styles.routeName}>{route.nombreRuta}</Text>
                    <Text style={styles.routeId}>RUTA #{String(route.idRuta).padStart(2, '0')}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: hasDestination ? colors.successSoft : colors.surfaceRaised }]}>
                    <Text style={[styles.statusText, { color: hasDestination ? colors.success : colors.muted }]}>{hasDestination ? 'GPS' : 'CATÁLOGO'}</Text>
                  </View>
                </View>
                <View style={styles.path}>
                  <View style={styles.pathRail}>
                    <View style={styles.originDot} />
                    <View style={styles.pathLine} />
                    <View style={styles.destinationDot} />
                  </View>
                  <View style={styles.pathCopy}>
                    <View><Text style={styles.pathLabel}>ORIGEN</Text><Text style={styles.pathValue}>{route.origen}</Text></View>
                    <View><Text style={styles.pathLabel}>DESTINO</Text><Text style={styles.pathValue}>{route.destino}</Text></View>
                  </View>
                </View>
                {hasDestination && onNavigate && <PrimaryButton label="Elegir este destino" icon="navigation" variant="secondary" onPress={() => onNavigate({ id: `catalog-${route.idRuta}`, name: route.destino, lat: route.destinoLatitud!, lng: route.destinoLongitud! })} />}
              </SurfaceCard>
            );
          })}
        </View>
      )}
    </ScreenScroll>
  );
};

const createStyles = (colors: AppColors) => StyleSheet.create({
  formCard: { gap: 13 },
  formHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  formIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  formHeadingCopy: { flex: 1, marginLeft: 10 },
  formTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  formSubtitle: { color: colors.muted, fontSize: 10.5, marginTop: 3 },
  formAction: { alignItems: 'flex-end', marginTop: 3 },
  loader: { marginTop: 34 },
  list: { gap: 10 },
  routeCard: { gap: 15 },
  routeHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  routeCopy: { flex: 1, minWidth: 0 },
  routeName: { color: colors.ink, fontSize: 13.5, fontWeight: '900' },
  routeId: { color: colors.subtle, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.8, marginTop: 3 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontSize: 8.5, fontWeight: '900' },
  path: { flexDirection: 'row', paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.line },
  pathRail: { width: 22, alignItems: 'center', paddingVertical: 3 },
  originDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
  pathLine: { width: 2, flex: 1, minHeight: 27, backgroundColor: colors.lineStrong, marginVertical: 4 },
  destinationDot: { width: 9, height: 9, borderRadius: 3, backgroundColor: colors.danger },
  pathCopy: { flex: 1, gap: 15 },
  pathLabel: { color: colors.subtle, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7 },
  pathValue: { color: colors.ink, fontSize: 11.5, fontWeight: '800', marginTop: 3 },
});
