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
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerSubtitle}>{subtitle}</Text>
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
  const tint = variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.ink : colors.white;
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
      <Feather name={icon} size={15} color={tint} />
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
      {icon ? <Feather name={icon} size={13} color={active ? colors.white : colors.muted} /> : null}
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
  sectionEyebrow: { color: colors.muted, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.9 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 4 },
  body: { color: colors.muted, fontSize: 11.5, lineHeight: 17 },
  title: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  divider: { height: 1, backgroundColor: colors.line },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.surfaceRaised },
  badgeText: { color: colors.muted, fontSize: 9.5, fontWeight: '900' },
});

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  screenContent: { width: '100%', maxWidth: 1100, alignSelf: 'center', padding: 16, paddingBottom: 34, gap: 12 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerCompact: { alignItems: 'stretch', flexDirection: 'column', paddingVertical: 4 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerAction: { flexShrink: 0 },
  headerActionCompact: { alignSelf: 'stretch' },
  headerTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  headerSubtitle: { color: colors.muted, fontSize: 11.5, marginTop: 4 },
  card: { padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  button: { minHeight: 48, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButton: { backgroundColor: colors.accent },
  secondaryButton: { backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.lineStrong },
  dangerButton: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.986 }] },
  disabled: { opacity: 0.45 },
  buttonText: { fontSize: 11.5, fontWeight: '900' },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  input: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surfaceSoft, color: colors.ink, paddingHorizontal: 13, fontSize: 12.5, fontWeight: '600' },
  chip: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 10.5, fontWeight: '800' },
  chipTextActive: { color: colors.white },
  emptyState: { alignItems: 'center', paddingVertical: 30 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  emptyTitle: { color: colors.ink, fontSize: 14, fontWeight: '900', marginTop: 12 },
  emptyMessage: { color: colors.muted, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 5, maxWidth: 320 },
});
