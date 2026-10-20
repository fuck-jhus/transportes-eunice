import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { type AppColors, useAppTheme } from '../theme/AppTheme';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const { colors, isDark, toggleTheme } = useAppTheme();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  const isWide = width >= 820;
  const isCompact = width < 390;
  const styles = useMemo(() => createStyles(colors, isWide, isCompact), [colors, isWide, isCompact]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const scrollRef = useRef<ScrollView>(null);
  const usernameInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const revealInput = (input: TextInput | null) => {
    setTimeout(() => {
      const inputHandle = input ? findNodeHandle(input) : null;
      if (inputHandle) {
        scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(inputHandle, 24, true);
      }
    }, 120);
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 360, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(translateY, { toValue: 0, duration: 360, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  }, [opacity, translateY]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Ingresa tu usuario y contraseña para continuar.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await login(username.trim(), password);
    } catch (requestError: any) {
      const message = requestError.response?.data?.mensaje
        || (requestError.response?.status === 429
          ? 'Se realizaron demasiados intentos. Espera un minuto.'
          : 'No se pudo iniciar sesión. Revisa tus credenciales y conexión.');
      setError(message);
      showToast(message, 'error', 'Acceso no disponible');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboardArea}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          style={[styles.themeButton, isCompact && styles.themeButtonCompact]}
          onPress={() => void toggleTheme()}
        >
          <Feather name={isDark ? 'sun' : 'moon'} size={17} color={colors.accent} />
          {!isCompact && <Text style={styles.themeButtonText}>{isDark ? 'Modo claro' : 'Modo oscuro'}</Text>}
        </Pressable>

        <Animated.View style={[styles.layout, { opacity, transform: [{ translateY }] }]}>
          {isWide && (
            <View style={styles.brandPanel}>
              <View style={styles.brandMark}>
                <MaterialCommunityIcons name="bus" size={27} color={colors.white} />
              </View>
              <View style={styles.brandCopy}>
                <Text style={styles.brandEyebrow}>CENTRO DE OPERACIONES</Text>
                <Text style={styles.brandTitle}>La flota completa, en una sola vista.</Text>
                <Text style={styles.brandDescription}>
                  Ubicación, recorridos y comunicación operativa desde un entorno creado para decisiones rápidas.
                </Text>
              </View>
              <View style={styles.brandStatus}>
                <View style={styles.brandStatusDot} />
                <Text style={styles.brandStatusText}>Conexión protegida con el servidor Eunice</Text>
              </View>
            </View>
          )}

          <View style={styles.formPanel}>
            <View style={styles.mobileBrandRow}>
              <View style={styles.formLogo}>
                <MaterialCommunityIcons name="bus" size={24} color={colors.accent} />
              </View>
              <View style={styles.mobileBrandCopy}>
                <Text style={styles.mobileBrandName}>Eunice</Text>
                <Text style={styles.mobileBrandSub}>Transportes y Agencia de Viajes</Text>
              </View>
            </View>

            <Text style={styles.eyebrow}>PORTAL DE OPERACIONES</Text>
            <Text style={styles.title}>Ingresa a tu cuenta</Text>
            <Text style={styles.subtitle}>Accede con las credenciales asignadas por administración.</Text>

            {error && (
              <View style={styles.errorBanner}>
                <Feather name="alert-circle" size={17} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Usuario</Text>
              <View style={styles.inputShell}>
                <Feather name="user" size={19} color={colors.subtle} />
                <TextInput
                  ref={usernameInputRef}
                  accessibilityLabel="Usuario"
                  value={username}
                  onChangeText={(value) => { setUsername(value); setError(null); }}
                  style={styles.input}
                  placeholder="Tu nombre de usuario"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  editable={!loading}
                  returnKeyType="next"
                  onFocus={() => revealInput(usernameInputRef.current)}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Contraseña</Text>
              <View style={styles.inputShell}>
                <Feather name="lock" size={19} color={colors.subtle} />
                <TextInput
                  ref={passwordInputRef}
                  accessibilityLabel="Contraseña"
                  value={password}
                  onChangeText={(value) => { setPassword(value); setError(null); }}
                  style={styles.input}
                  placeholder="Ingresa tu contraseña"
                  placeholderTextColor={colors.subtle}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  editable={!loading}
                  returnKeyType="done"
                  onFocus={() => revealInput(passwordInputRef.current)}
                  onSubmitEditing={() => void handleLogin()}
                />
                <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} style={styles.eyeButton} onPress={() => setShowPassword((visible) => !visible)}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={19} color={colors.muted} />
                </Pressable>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed, loading && styles.submitButtonDisabled]}
              onPress={() => void handleLogin()}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Text style={styles.submitText}>Ingresar</Text>
                  <Feather name="arrow-right" size={19} color={colors.white} />
                </>
              )}
            </Pressable>

            <View style={styles.securityNote}>
              <Feather name="shield" size={15} color={colors.success} />
              <Text style={styles.securityText}>Sesión móvil cifrada y almacenada de forma segura en este dispositivo.</Text>
            </View>
          </View>
        </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const createStyles = (colors: AppColors, isWide: boolean, isCompact: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  safeArea: { flex: 1 },
  keyboardArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingTop: isWide ? 28 : 64,
    paddingBottom: isWide ? 28 : 18,
    paddingHorizontal: isWide ? 28 : isCompact ? 12 : 18,
    justifyContent: 'center',
  },
  themeButton: {
    position: 'absolute', top: 10, right: isCompact ? 12 : 18, zIndex: 3, minHeight: 48, minWidth: 48, paddingHorizontal: 14,
    borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  themeButtonCompact: { width: 44, paddingHorizontal: 0, justifyContent: 'center' },
  themeButtonText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  layout: {
    width: '100%', maxWidth: isWide ? 1040 : 520, alignSelf: 'center', minHeight: isWide ? 610 : undefined,
    flexDirection: isWide ? 'row' : 'column', borderRadius: isCompact ? 22 : 28, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    shadowColor: '#04121c', shadowOffset: { width: 0, height: 22 }, shadowOpacity: 0.18,
    shadowRadius: 44, elevation: 12,
  },
  brandPanel: { width: '52%', padding: 42, justifyContent: 'space-between', backgroundColor: colors.nav },
  brandMark: {
    width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  brandCopy: { marginVertical: 32 },
  brandEyebrow: { color: '#ff9b6c', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 14 },
  brandTitle: { color: colors.white, fontSize: 39, lineHeight: 45, fontWeight: '900', letterSpacing: -1.2 },
  brandDescription: { color: colors.navMuted, fontSize: 15, lineHeight: 23, fontWeight: '500', marginTop: 18 },
  brandStatus: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#49b997' },
  brandStatusText: { color: colors.navMuted, fontSize: 12, fontWeight: '600' },
  formPanel: { flex: 1, paddingHorizontal: isWide ? 48 : isCompact ? 18 : 24, paddingVertical: isWide ? 46 : isCompact ? 24 : 30, justifyContent: 'center' },
  mobileBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: isCompact ? 24 : 30 },
  mobileBrandCopy: { flex: 1, minWidth: 0 },
  formLogo: {
    width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine,
  },
  mobileBrandName: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  mobileBrandSub: { color: colors.muted, fontSize: 10.5, marginTop: 2 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, marginBottom: 9 },
  title: { color: colors.ink, fontSize: isCompact ? 27 : 31, lineHeight: isCompact ? 32 : 37, fontWeight: '900', letterSpacing: -0.8 },
  subtitle: { color: colors.muted, fontSize: isCompact ? 13 : 14, lineHeight: 20, marginTop: 8, marginBottom: isCompact ? 20 : 25 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 13,
    borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoft, marginBottom: 16,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  fieldGroup: { marginBottom: 17 },
  label: { color: colors.ink, fontSize: 12.5, fontWeight: '800', marginBottom: 7 },
  inputShell: {
    minHeight: 54, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 15,
    backgroundColor: colors.surfaceSoft, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11,
  },
  input: { flex: 1, minHeight: 52, color: colors.ink, fontSize: 14, fontWeight: '600', paddingVertical: 0 },
  eyeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  submitButton: {
    minHeight: 55, marginTop: 7, borderRadius: 15, paddingHorizontal: 18,
    backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 5,
  },
  submitButtonPressed: { transform: [{ scale: 0.988 }], opacity: 0.92 },
  submitButtonDisabled: { opacity: 0.65 },
  submitText: { color: colors.white, fontSize: 14, fontWeight: '900' },
  securityNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 22 },
  securityText: { flex: 1, color: colors.muted, fontSize: 11.5, lineHeight: 17, fontWeight: '600' },
});
