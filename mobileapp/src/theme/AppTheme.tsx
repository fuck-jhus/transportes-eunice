import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = '@map_theme_preference';

// Paleta "Ruta cálida": verde profundo y amarillo de bus sobre crema; modo oscuro de centro de control.
export const lightColors = {
  canvas: '#efe8da',
  surface: '#fffdf8',
  surfaceSoft: '#f8f3ea',
  surfaceRaised: '#f3ecdf',
  line: '#e6dcc9',
  lineStrong: '#ddd3c0',
  ink: '#1e2a24',
  muted: '#5b6660',
  subtle: '#7d8680',
  nav: '#fffdf8',
  navSoft: '#dcebe3',
  navMuted: '#5b6660',
  scrim: '#1e2a2480',
  accent: '#1f5c46',
  accentStrong: '#163f31',
  accentSoft: '#dcebe3',
  accentLine: '#b7d1c4',
  onAccent: '#ffffff',
  highlight: '#e8a317',
  onHighlight: '#1e2a24',
  brand: '#1f5c46',
  onStatus: '#ffffff',
  success: '#1f7a52',
  successSoft: '#dcebe3',
  warning: '#7a5300',
  warningSoft: '#f7e7c4',
  danger: '#b23a2e',
  dangerSoft: '#f5ddd9',
  focus: '#e8a317',
  white: '#ffffff',
} as const;

export const darkColors = {
  canvas: '#0b0f14',
  surface: '#171e26',
  surfaceSoft: '#0f1419',
  surfaceRaised: '#1d2630',
  line: '#26303b',
  lineStrong: '#33404d',
  ink: '#e6edf3',
  muted: '#9aa7b4',
  subtle: '#6f7c89',
  nav: '#0f1419',
  navSoft: '#2a2210',
  navMuted: '#9aa7b4',
  scrim: '#05080bb8',
  accent: '#e8a317',
  accentStrong: '#f2b53a',
  accentSoft: '#2a2210',
  accentLine: '#5c4614',
  onAccent: '#0b0f14',
  highlight: '#e8a317',
  onHighlight: '#0b0f14',
  brand: '#1f5c46',
  onStatus: '#0b0f14',
  success: '#4cc38a',
  successSoft: '#13291f',
  warning: '#e8a317',
  warningSoft: '#2a2210',
  danger: '#ff7b6b',
  dangerSoft: '#331b18',
  focus: '#e8a317',
  white: '#ffffff',
} as const;

export type AppColors = { readonly [K in keyof typeof lightColors]: string };

interface AppThemeContextValue {
  isDark: boolean;
  colors: AppColors;
  toggleTheme: () => Promise<void>;
}

const AppThemeContext = createContext<AppThemeContextValue>({
  isDark: true,
  colors: darkColors,
  toggleTheme: async () => {},
});

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((theme) => setIsDark(theme !== 'light'))
      .catch(() => {});
  }, []);

  const toggleTheme = async () => {
    const next = !isDark;
    setIsDark(next);
    await AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light').catch(() => {});
  };

  const value = useMemo(() => ({
    isDark,
    colors: isDark ? darkColors : lightColors,
    toggleTheme,
  }), [isDark]);

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
};

export const useAppTheme = () => useContext(AppThemeContext);
