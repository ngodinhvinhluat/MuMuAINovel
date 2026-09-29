import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/vi';
import zh from './locales/zh.json';
import vi from './locales/vi.json';
import valuesVi from './locales/values.vi.json';

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
    vi: { translation: vi, values: valuesVi },
  },
  ns: ['translation', 'values'],
  defaultNS: 'translation',
  lng: initialLanguage,
  fallbackLng: 'zh',
  // 使用中文原文作为 key，因此禁用 key / 命名空间分隔符
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
  showSupportNotice: false,
  saveMissing: true,
  missingKeyHandler: (_lngs, ns, key) => {
    if (ns === 'translation') recordMissing('translation', key);
  },
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

// ========== Lớp nghĩa cho dữ liệu (label) ==========
// Giá trị lưu/so sánh vẫn là tiếng Trung; label() chỉ đổi chữ hiển thị.

const HAN_RE = /[一-鿿]/;
const MISSING_STORAGE_KEY = 'mumu_i18n_missing';
const SHOW_ORIGINAL_STORAGE_KEY = 'mumu_label_show_original';
const MISSING_LIMIT = 3000;

type MissingNs = 'translation' | 'values';
let missingCache: Record<MissingNs, string[]> | null = null;
let missingSaveTimer: ReturnType<typeof setTimeout> | null = null;

function loadMissing(): Record<MissingNs, string[]> {
  if (missingCache) return missingCache;
  missingCache = { translation: [], values: [] };
  try {
    const raw = window.localStorage.getItem(MISSING_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.translation) && Array.isArray(parsed.values)) missingCache = parsed;
  } catch {
    // ignore
  }
  return missingCache!;
}

function recordMissing(ns: MissingNs, key: string) {
  if (getLanguage() !== 'vi' || !key || !HAN_RE.test(key)) return;
  const store = loadMissing();
  if (store[ns].includes(key) || store[ns].length >= MISSING_LIMIT) return;
  store[ns].push(key);
  if (missingSaveTimer) return;
  missingSaveTimer = setTimeout(() => {
    missingSaveTimer = null;
    try {
      window.localStorage.setItem(MISSING_STORAGE_KEY, JSON.stringify(store));
    } catch {
      // ignore
    }
  }, 1000);
}

/** Danh sách chuỗi chưa dịch đã gặp khi dùng app (để chạy scripts/i18n-translate.mjs --from). */
export const getMissingTranslations = () => loadMissing();

export const clearMissingTranslations = () => {
  missingCache = { translation: [], values: [] };
  try {
    window.localStorage.removeItem(MISSING_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const getShowOriginal = (): boolean => {
  try {
    return window.localStorage.getItem(SHOW_ORIGINAL_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
};

export const setShowOriginal = (value: boolean) => {
  try {
    window.localStorage.setItem(SHOW_ORIGINAL_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // ignore
  }
};

interface ValuePattern {
  regex: RegExp;
  translation: string;
}

let valuePatterns: ValuePattern[] | null = null;

function getValuePatterns(): ValuePattern[] {
  if (valuePatterns) return valuePatterns;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  valuePatterns = Object.entries(valuesVi as Record<string, string>)
    .filter(([key]) => /\{\{\d+\}\}/.test(key))
    .map(([key, translation]) => ({
      regex: new RegExp('^' + key.split(/\{\{\d+\}\}/).map(escape).join('([\\s\\S]*?)') + '$'),
      translation,
    }))
    // Mẫu dài (cụ thể hơn) được thử trước
    .sort((a, b) => b.regex.source.length - a.regex.source.length);
  return valuePatterns;
}

const valuesTable = valuesVi as Record<string, string>;
const translationTable = vi as Record<string, string>;

function lookupValue(text: string): string | undefined {
  const exact = valuesTable[text] ?? translationTable[text];
  if (exact) return exact;
  for (const { regex, translation } of getValuePatterns()) {
    const match = regex.exec(text);
    if (match) {
      // Phần biến (ví dụ tên riêng, lỗi con) cũng được thử dịch
      return translation.replace(/\{\{(\d+)\}\}/g, (_, i) => {
        const part = match[Number(i) + 1] ?? '';
        return lookupValue(part.trim()) ?? part;
      });
    }
  }
  return undefined;
}

/**
 * Đổi chữ hiển thị của một giá trị dữ liệu (enum, dữ liệu mẫu, thông báo lỗi từ backend) sang ngôn ngữ giao diện.
 * Không dùng kết quả để lưu hoặc so sánh. Giá trị không có bản dịch được trả về nguyên văn.
 */
export function label(value?: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  const text = value;
  if (getLanguage() === 'zh' || !HAN_RE.test(text)) return text;
  const trimmed = text.trim();
  const translated = lookupValue(trimmed);
  if (translated) return translated;
  // Danh sách nối bằng 、，, (ví dụ thể loại "玄幻、都市")
  if (/[、,，]/.test(trimmed)) {
    const parts = trimmed.split(/\s*[、,，]\s*/);
    if (parts.length > 1 && parts.every((p) => lookupValue(p))) return parts.map((p) => lookupValue(p)).join(', ');
  }
  recordMissing('values', trimmed);
  return text;
}

/** label() cho mảng hoặc chuỗi nối bằng dấu 、 */
export const labelList = (values?: string[] | string | null, sep = ', '): string => {
  if (!values) return '';
  const list = Array.isArray(values) ? values : String(values).split(/\s*[、,，]\s*/);
  return list.filter(Boolean).map((v) => label(v)).join(sep);
};

export default i18n;
