import { useContext } from 'react';
import { ThemeModeContext } from './themeContext';
import type { ThemeContextValue } from './themeContext';
import { t } from '../i18n';

export const useThemeMode = (): ThemeContextValue => {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error(t('useThemeMode 必须在 ThemeProvider 内使用'));
  }
  return context;
};
