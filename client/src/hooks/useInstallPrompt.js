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

export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    function handler(e) {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    }

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setCanInstall(false);
    return outcome === 'accepted';
  }, [deferredPrompt]);

  return { canInstall, install };
}
