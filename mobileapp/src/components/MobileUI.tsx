import React, { useMemo } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppColors, useAppTheme } from '../theme/AppTheme';

export const DialogViewport = ({ children }: { children: React.ReactNode }) => {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return <ScrollView style={{ flex: 1, backgroundColor: colors.scrim }}
    contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center',
      paddingHorizontal: 24, paddingTop: Math.max(24, insets.top + 12), paddingBottom: Math.max(24, insets.bottom + 12) }}
    keyboardShouldPersistTaps="handled" bounces={false} accessibilityViewIsModal>
    {children}
  </ScrollView>;
};

export const ScreenScroll: React.FC<ScrollViewProps> = ({
  children,
  contentContainerStyle,
  automaticallyAdjustKeyboardInsets,
  keyboardDismissMode,
  keyboardShouldPersistTaps,
  ...props
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets ?? Platform.OS === 'ios'}
      keyboardDismissMode={keyboardDismissMode ?? (Platform.OS === 'ios' ? 'interactive' : 'on-drag')}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
      {...props}
    >
      {children}
    </ScrollView>
  );
};

export const ScreenHeader = ({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) => {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const compact = width < 430;
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.headerCopy}>
        {/* El título ya está en el encabezado de la app; aquí solo va el resumen. */}
        <Text style={styles.headerSubtitle} accessibilityLabel={`${title}. ${subtitle}`}>{subtitle}</Text>
      </View>
      {action ? <View style={[styles.headerAction, compact && styles.headerActionCompact]}>{action}</View> : null}
    </View>
  );
};

export const SurfaceCard = ({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.card, style]}>{children}</View>;
};

export const PrimaryButton = ({
  label,
  icon = 'plus',
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  onPress?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tint = variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.ink : colors.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primaryButton,
        variant === 'secondary' && styles.secondaryButton,
        variant === 'danger' && styles.dangerButton,
        pressed && styles.buttonPressed,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Feather name={icon} size={17} color={tint} />
      <Text numberOfLines={1} style={[styles.buttonText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
};

export const AppTextField = ({ label, ...props }: TextInputProps & { label: string }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.subtle} style={styles.input} {...props} />
    </View>
  );
};

export const ChoiceChip = ({ label, active, onPress, icon }: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      {icon ? <Feather name={icon} size={14} color={active ? colors.canvas : colors.muted} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
};

export const EmptyState = ({ icon, title, message }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  message: string;
}) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SurfaceCard style={styles.emptyState}>
      <View style={styles.emptyIcon}><Feather name={icon} size={23} color={colors.subtle} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </SurfaceCard>
  );
};

export const uiStyles = (colors: AppColors) => StyleSheet.create({
  sectionEyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: 2, letterSpacing: -0.3 },
  body: { color: colors.muted, fontSize: 13.5, lineHeight: 20 },
  title: { color: colors.ink, fontSize: 15.5, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surfaceSoft },
  badgeText: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
});

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  screenContent: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 36, gap: 14 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 4 },
  headerCompact: { alignItems: 'stretch', flexDirection: 'column', paddingVertical: 2 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerAction: { flexShrink: 0 },
  headerActionCompact: { alignSelf: 'stretch' },
  headerTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: { padding: 18, borderRadius: 24, backgroundColor: colors.surface },
  button: { minHeight: 50, borderRadius: 25, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButton: { backgroundColor: colors.accent },
  secondaryButton: { backgroundColor: colors.surfaceSoft },
  dangerButton: { backgroundColor: colors.dangerSoft },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
  buttonText: { fontSize: 14, fontWeight: '700' },
  field: { gap: 7 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  input: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceSoft, color: colors.ink, paddingHorizontal: 16, fontSize: 15 },
  chip: { minHeight: 40, borderRadius: 20, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.ink },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.canvas },
  emptyState: { alignItems: 'center', paddingVertical: 34 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '700', marginTop: 14 },
  emptyMessage: { color: colors.muted, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 5, maxWidth: 320 },
});
