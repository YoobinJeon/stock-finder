import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export const THEME_EVENT = 'sf-theme-change';

const STORAGE_KEY = 'sf-theme';

/** 현재 테마 조회 — <html class="dark"> 존재 여부 기준. */
export function getTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** 테마 적용 — 클래스 토글 + localStorage 저장 + 구독자 알림. */
export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage 접근 불가 시 무시 (이번 세션만 테마 유지) */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(THEME_EVENT, callback);
  return () => window.removeEventListener(THEME_EVENT, callback);
}

export interface UseThemeResult {
  theme: Theme;
  toggle: () => void;
}

export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(subscribe, getTheme, (): Theme => 'light');

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme]);

  return { theme, toggle };
}
