import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenHeader, ScreenScroll, SurfaceCard } from '../components/MobileUI';
import { useAppTheme, type AppColors } from '../theme/AppTheme';
import type { MobileTrackingSnapshot } from '../types/telemetry';

export interface LiveMapScreenProps {
  user?: { tipoRol?: string };
  onNavigateTab?: (tab: string) => void;
  isPrivacyMode?: boolean;
  onTogglePrivacyMode?: () => void;
  mapTheme?: 'dark' | 'light';
  tracking?: MobileTrackingSnapshot;
  onNavigationChange?: (destination: { lat: number; lng: number; name?: string } | null) => void;
}

export const LiveMapScreen: React.FC<LiveMapScreenProps> = ({ user, tracking }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isPilot = user?.tipoRol === 'Piloto';

  return (
    <ScreenScroll>
      <ScreenHeader
        title="Monitoreo de unidades"
        subtitle="Vista de comprobación del cliente móvil"
      />
      <SurfaceCard style={styles.mapPreview}>
        <View style={styles.gridHorizontal} />
        <View style={styles.gridVertical} />
        <View style={styles.mapGlow} />
        <View style={styles.pin}>
          <MaterialCommunityIcons name="bus" size={25} color={colors.white} />
        </View>
        <View style={styles.previewCopy}>
          <Text style={styles.previewEyebrow}>MAPA NATIVO</Text>
          <Text style={styles.previewTitle}>El mapa se habilita en Android y iOS</Text>
          <Text style={styles.previewText}>
            La versión instalada utiliza GPS, navegación y estilos de mapa adaptados al modo claro u oscuro.
          </Text>
        </View>
      </SurfaceCard>
      {isPilot && (
        <SurfaceCard style={styles.statusCard}>
          <View style={styles.statusIcon}><Feather name="navigation" size={20} color={colors.accent} /></View>
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>{tracking?.statusText ?? 'Esperando un viaje asignado'}</Text>
            <Text style={styles.statusText}>
              {tracking?.assignedTrip
                ? `${tracking.assignedTrip.placaAutobus} · ${tracking.speedKmh.toFixed(0)} km/h`
                : 'El GPS inicia automáticamente al recibir un viaje activo.'}
            </Text>
          </View>
        </SurfaceCard>
      )}
    </ScreenScroll>
  );
};

const createStyles = (colors: AppColors) => StyleSheet.create({
  mapPreview: { minHeight: 360, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceSoft },
  gridHorizontal: { position: 'absolute', left: -40, right: -40, top: '48%', height: 1, backgroundColor: colors.lineStrong, transform: [{ rotate: '-8deg' }] },
  gridVertical: { position: 'absolute', top: -40, bottom: -40, left: '52%', width: 1, backgroundColor: colors.lineStrong, transform: [{ rotate: '14deg' }] },
  mapGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: colors.accentSoft, opacity: 0.6 },
  pin: { width: 62, height: 62, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderWidth: 5, borderColor: colors.surface },
  previewCopy: { marginTop: 24, maxWidth: 390, alignItems: 'center', paddingHorizontal: 18 },
  previewEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  previewTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', textAlign: 'center', marginTop: 6 },
  previewText: { color: colors.muted, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 7 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  statusCopy: { flex: 1 },
  statusTitle: { color: colors.ink, fontSize: 12.5, fontWeight: '900' },
  statusText: { color: colors.muted, fontSize: 10.5, marginTop: 3 },
});
