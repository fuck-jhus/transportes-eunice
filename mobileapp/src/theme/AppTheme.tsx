import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = '@map_theme_preference';

export const lightColors = {
  canvas: '#f2f5f4',
  surface: '#ffffff',
  surfaceSoft: '#f7f9f8',
  surfaceRaised: '#f1f5f3',
  line: '#dfe6e3',
  lineStrong: '#cbd6d2',
  ink: '#172429',
  muted: '#66777d',
  subtle: '#8a999d',
  nav: '#ffffff',
  navSoft: '#fff0e8',
  navMuted: '#66777d',
  scrim: '#17242980',
  accent: '#d85f28',
  accentStrong: '#b9481b',
  accentSoft: '#fff0e8',
  accentLine: '#f0c6b1',
  success: '#147d62',
  successSoft: '#e7f5f0',
  warning: '#b56d12',
  warningSoft: '#fff4dc',
  danger: '#c94c4c',
  dangerSoft: '#fff0f0',
  focus: '#367786',
  white: '#ffffff',
} as const;

export const darkColors = {
  canvas: '#09161b',
  surface: '#102229',
  surfaceSoft: '#152b33',
  surfaceRaised: '#143039',
  line: '#254047',
  lineStrong: '#355159',
  ink: '#edf3f1',
  muted: '#9bacae',
  subtle: '#74888b',
  nav: '#071419',
  navSoft: '#143039',
  navMuted: '#8fa5aa',
  scrim: '#02090db8',
  accent: '#f07840',
  accentStrong: '#ff8e59',
  accentSoft: '#33251f',
  accentLine: '#71432e',
  success: '#49b997',
  successSoft: '#12352f',
  warning: '#e5a64a',
  warningSoft: '#332b1c',
  danger: '#f27b7b',
  dangerSoft: '#3a2022',
  focus: '#72aebb',
  white: '#ffffff',
} as const;

export type AppColors = typeof lightColors | typeof darkColors;

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
