/**
 * InstallBanner — non-intrusive PWA install prompt.
 *
 * Shows a dismissible banner at the bottom of the screen when the browser
 * supports PWA installation. Uses the browser's beforeinstallprompt event
 * for one-tap install.
 */
import { useState } from 'react';
import useInstallPrompt from '../hooks/useInstallPrompt';
import { Download, X } from 'lucide-react';

export default function InstallBanner() {
  const { canInstall, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('install-dismissed') === '1');

  if (!canInstall || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    sessionStorage.setItem('install-dismissed', '1');
  }

  async function handleInstall() {
    const accepted = await install();
    if (accepted) setDismissed(true);
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-[90] animate-slide-up rounded-xl border border-brand-200 bg-white p-4 shadow-lg sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100">
          <Download className="h-5 w-5 text-brand-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">Install RestoAI</p>
          <p className="text-xs text-gray-500">Add to your home screen for quick access.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={handleInstall} className="btn-primary py-1.5 text-xs">Install</button>
            <button onClick={handleDismiss} className="btn-secondary py-1.5 text-xs">Not now</button>
          </div>
        </div>
        <button onClick={handleDismiss} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
