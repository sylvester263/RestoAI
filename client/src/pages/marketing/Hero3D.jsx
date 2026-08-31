import { Suspense, lazy, useEffect, useState } from 'react';
import whatsappChat from '../../assets/marketing/whatsapp-chat.webp';

// The R3F/three.js scene is real bundle weight — split into its own chunk
// and loaded only on devices that can actually render it, so it never
// blocks first paint of the rest of the marketing page.
const Hero3DCanvas = lazy(() => import('./Hero3DCanvas.jsx'));

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// Same physical footprint as the 3D phone, so swapping between the two
// never shifts hero layout.
function StaticPhoneFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <img
        src={whatsappChat}
        alt="RestoAI WhatsApp ordering conversation"
        className="w-56 rounded-[1.75rem] border-4 border-gray-900 shadow-2xl sm:w-64"
        style={{ transform: 'rotate(-6deg)' }}
      />
    </div>
  );
}

export default function Hero3D() {
  const [webglOk, setWebglOk] = useState(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    setWebglOk(supportsWebGL());
  }, []);

  // Still checking capability, or no WebGL — the static image never leaves
  // a blank hero, on this first render or on an incapable device.
  if (webglOk === null || webglOk === false) {
    return <StaticPhoneFallback />;
  }

  return (
    <Suspense fallback={<StaticPhoneFallback />}>
      <Hero3DCanvas reducedMotion={reducedMotion} />
    </Suspense>
  );
}
