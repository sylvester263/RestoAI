/**
 * useDarkMode — manages dark mode preference with system-aware defaults.
 *
 * Stores the user's choice in localStorage ('dark' | 'light' | 'system').
 * Applies the `dark` class to <html> when dark mode is active.
 *
 * Usage:
 *   const { isDark, mode, setMode } = useDarkMode();
 *   // mode: 'dark' | 'light' | 'system'
 *   // setMode('dark') — force dark
 *   // setMode('system') — follow OS preference
 */
import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'restoai-theme';

function getSystemPref() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveMode(mode) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return getSystemPref(); // 'system'
}

export default function useDarkMode() {
  const [mode, setModeState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
    return 'system';
  });

  const isDark = resolveMode(mode);

  // Apply the `dark` class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Listen for OS theme changes when mode is 'system'
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      // Force re-render by toggling state
      setModeState('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback((newMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  const toggle = useCallback(() => {
    setMode(isDark ? 'light' : 'dark');
  }, [isDark, setMode]);

  return { isDark, mode, setMode, toggle };
}
