import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/vi';
import zh from './locales/zh.json';
import vi from './locales/vi.json';

/**
 * i18n 说明 / Ghi chú i18n
 * - 翻译 key 直接使用中文原文（natural-language keys）：zh.json 为原文映射，vi.json 为越南语译文。
 * - 缺失的译文会自动回退到中文原文。
 * - 插值统一使用 i18next 的 {{var}} 语法。
 * - 切换语言后会刷新页面，使模块级常量（选项列表等）也能使用新语言。
 */

export type AppLanguage = 'zh' | 'vi';

export const SUPPORTED_LANGUAGES: { value: AppLanguage; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'vi', label: 'Tiếng Việt' },
];

export const LANGUAGE_STORAGE_KEY = 'mumu_language';

const isSupported = (lang: unknown): lang is AppLanguage => lang === 'zh' || lang === 'vi';

export const detectLanguage = (): AppLanguage => {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isSupported(stored)) {
      return stored;
    }
  } catch {
    // localStorage 不可用时忽略
  }
  try {
    const candidates = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ].filter(Boolean);
    for (const lang of candidates) {
      const lower = lang.toLowerCase();
      if (lower.startsWith('vi')) return 'vi';
      if (lower.startsWith('zh')) return 'zh';
    }
  } catch {
    // navigator 不可用时忽略
  }
  return 'zh';
};

const initialLanguage = detectLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    vi: { translation: vi },
  },
  lng: initialLanguage,
  fallbackLng: 'zh',
  // 使用中文原文作为 key，因此禁用 key / 命名空间分隔符
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

const applyDocumentLanguage = (lang: AppLanguage) => {
  dayjs.locale(lang === 'vi' ? 'vi' : 'zh-cn');
  try {
    document.documentElement.lang = lang === 'vi' ? 'vi' : 'zh-CN';
  } catch {
    // ignore
  }
};

applyDocumentLanguage(initialLanguage);

export const getLanguage = (): AppLanguage => (isSupported(i18n.language) ? i18n.language : 'zh');

/** BCP 47 locale，用于 toLocaleString / Intl 等 */
export const getDateLocale = (): string => (getLanguage() === 'vi' ? 'vi-VN' : 'zh-CN');

/**
 * 切换界面语言并刷新页面 / Đổi ngôn ngữ giao diện và tải lại trang.
 */
export const setLanguage = (lang: AppLanguage, reload = true) => {
  if (!isSupported(lang)) return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  if (lang === getLanguage()) return;
  void i18n.changeLanguage(lang);
  applyDocumentLanguage(lang);
  if (reload) {
    window.location.reload();
  }
};

/**
 * 全局翻译函数（组件内外均可使用）。key 为中文原文，插值使用 {{var}} 语法。
 */
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options as never) as unknown as string;
}

export default i18n;
