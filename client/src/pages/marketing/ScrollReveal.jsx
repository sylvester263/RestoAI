import { motion, useReducedMotion } from 'framer-motion';

const TAGS = { div: motion.div, section: motion.section, article: motion.article };

// Same fade + slight upward slide on every non-hero section, per impl-26 —
// one consistent motion language rather than a different treatment per section.
export default function ScrollReveal({ children, as = 'div', className = '', delay = 0 }) {
  const reduceMotion = useReducedMotion();
  const Tag = TAGS[as] || motion.div;

  return (
    <Tag
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Tag>
  );
}
