/**
 * useInstallPrompt — captures the `beforeinstallprompt` event and exposes
 * a one-tap install experience for PWA-capable browsers.
 *
 * Usage in a component:
 *   const { canInstall, install } = useInstallPrompt();
 *   return canInstall ? <button onClick={install}>Install app</button> : null;
 *
 * The prompt auto-dismisses after install or if the user dismisses it natively.
 */
import { useState, useEffect, useCallback } from 'react';

// The browser fires beforeinstallprompt once per page load. It is captured
// at module level so every component using this hook (the floating banner,
// the inline one on the POS) sees it, whichever mounted first.
let savedPrompt = null;
const subscribers = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    savedPrompt = e;
    subscribers.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    savedPrompt = null;
    subscribers.forEach((fn) => fn(false));
  });
}

export default function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(!!savedPrompt);

  useEffect(() => {
    subscribers.add(setCanInstall);
    setCanInstall(!!savedPrompt);
    return () => subscribers.delete(setCanInstall);
  }, []);

  const install = useCallback(async () => {
    if (!savedPrompt) return false;
    const prompt = savedPrompt;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    savedPrompt = null;
    subscribers.forEach((fn) => fn(false));
    return outcome === 'accepted';
  }, []);

  return { canInstall, install };
}
