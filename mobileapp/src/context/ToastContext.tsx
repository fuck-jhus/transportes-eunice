import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/AppTheme';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; title?: string } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'info', title?: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ message, tone, title });
    opacity.setValue(0);
    translateY.setValue(-12);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
    timeoutRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start(() => setToast(null));
    }, 3_600);
  }, [opacity, translateY]);

  const value = useMemo(() => ({ showToast }), [showToast]);
  const toneColor = toast?.tone === 'success'
    ? colors.success
    : toast?.tone === 'error'
      ? colors.danger
      : toast?.tone === 'warning'
        ? colors.warning
        : colors.focus;
  const icon = toast?.tone === 'success'
    ? 'check-circle'
    : toast?.tone === 'error'
      ? 'x-circle'
      : toast?.tone === 'warning'
        ? 'alert-triangle'
        : 'info';

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <View pointerEvents="none" style={[styles.layer, { top: insets.top + 8 }]}>
          <Animated.View style={[
            styles.toast,
            { backgroundColor: colors.surface, borderColor: colors.lineStrong, opacity, transform: [{ translateY }] },
          ]}>
            <View style={[styles.iconBox, { backgroundColor: `${toneColor}20` }]}>
              <Feather name={icon} size={18} color={toneColor} />
            </View>
            <View style={styles.copy}>
              {toast.title ? <Text style={[styles.title, { color: colors.ink }]}>{toast.title}</Text> : null}
              <Text style={[styles.message, { color: colors.muted }]}>{toast.message}</Text>
            </View>
          </Animated.View>
        </View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 12, right: 12, zIndex: 9999, alignItems: 'center' },
  toast: {
    width: '100%', maxWidth: 520, minHeight: 62, borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 12,
  },
  iconBox: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, marginLeft: 11 },
  title: { fontSize: 13, fontWeight: '800', marginBottom: 2 },
  message: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
});
