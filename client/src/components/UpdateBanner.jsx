import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/** Shown when a new app version has taken over (see lib/serviceWorker.js). */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('app-update-ready', on);
    return () => window.removeEventListener('app-update-ready', on);
  }, []);
  if (!ready) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-3 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg" data-testid="update-banner">
      A new version of RestoAI is ready.
      <button type="button" onClick={() => window.location.reload()} className="flex items-center gap-1 rounded bg-white/15 px-2 py-1 font-medium hover:bg-white/25">
        <RefreshCw className="h-3.5 w-3.5" /> Reload
      </button>
    </div>
  );
}
