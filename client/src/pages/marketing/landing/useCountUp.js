import { useEffect, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';

// Animates a number toward `target` whenever it changes (or once `active`
// turns true). Reduced-motion visitors get the final value immediately.
export default function useCountUp(target, { active = true, duration = 0.9 } = {}) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);

  useEffect(() => {
    if (!active) return undefined;
    if (reduce) {
      setValue(target);
      return undefined;
    }
    const controls = animate(value, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, reduce]);

  return value;
}
