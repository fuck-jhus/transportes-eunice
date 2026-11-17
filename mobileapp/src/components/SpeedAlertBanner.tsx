import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SPEED_LIMIT_KMH, type SpeedAlertState } from '../utils/speedAlert';

/** Aviso grande y pulsante que queda encima de cualquier pantalla mientras dure el exceso. */
export const SpeedAlertBanner: React.FC<{ alert: SpeedAlertState; top: number }> = ({ alert, top }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!alert.active) { enter.setValue(0); return; }
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [alert.active, enter, pulse]);
  if (!alert.active) return null;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [-160, 0] });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <Animated.View style={[styles.edge, { opacity: glow }]} />
      <Animated.View accessibilityRole="alert" accessibilityLiveRegion="assertive"
        style={[styles.card, { top: top + 10, transform: [{ translateY }, { scale }] }]}>
        <View style={styles.icon}><Feather name="alert-triangle" size={30} color="#B23A2E" /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>¡Reduce la velocidad!</Text>
          <Text style={styles.body}>Exceso de velocidad · límite {SPEED_LIMIT_KMH} km/h</Text>
        </View>
        <View style={styles.speed}>
          <Text style={styles.speedValue}>{alert.speedKmh}</Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  layer: { zIndex: 2000, elevation: 30 },
  edge: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: 6, borderColor: '#E5483B' },
  card: {
    position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 24, backgroundColor: '#B23A2E',
    shadowColor: '#7A1E16', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 16,
  },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFF4F1', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  body: { color: '#FFE3DE', fontSize: 13, fontWeight: '700', marginTop: 3 },
  speed: { alignItems: 'center', minWidth: 62 },
  speedValue: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', lineHeight: 34, fontVariant: ['tabular-nums'] },
  speedUnit: { color: '#FFE3DE', fontSize: 11, fontWeight: '800' },
});
