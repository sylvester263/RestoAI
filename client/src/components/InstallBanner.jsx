/**
 * InstallBanner — non-intrusive PWA install prompt.
 *
 * Shows a dismissible prompt when the browser supports PWA installation.
 * Uses the browser's beforeinstallprompt event for one-tap install.
 *
 * Two placements:
 *  - "floating" (default): a card pinned to the bottom of the screen.
 *  - "inline": an in-flow strip at the top of a page. The POS uses this
 *    (impl-33) so the prompt can never cover the till's action buttons
 *    (New Tab, Settle, Take cash) at any screen size — Layout skips the
 *    floating one on /pos.
 * Dismissing either one hides both for the rest of the session.
 */
import { useState } from 'react';
import useInstallPrompt from '../hooks/useInstallPrompt';
import { Download, X } from 'lucide-react';

export default function InstallBanner({ variant = 'floating' }) {
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

  if (variant === 'inline') {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-800 dark:bg-brand-900/20" data-testid="install-banner-inline">
        <Download className="h-4 w-4 shrink-0 text-brand-600" />
        <span className="flex-1 text-gray-800 dark:text-gray-200">Install the RestoAI till on this device — it keeps selling when the internet drops.</span>
        <button onClick={handleInstall} className="btn-primary py-1 text-xs">Install</button>
        <button onClick={handleDismiss} className="text-gray-400 hover:text-gray-600" aria-label="Dismiss install prompt">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-[90] animate-slide-up rounded-xl border border-brand-200 bg-white p-4 shadow-lg sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm" data-testid="install-banner">
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
