import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChefHat, RotateCcw, Send } from 'lucide-react';

// A scripted, looping WhatsApp order that lands on a kitchen ticket. It is a
// product illustration with sample items, not a recording of a real customer.
const SCRIPT = [
  { id: 'c1', from: 'customer', text: 'Do zinger burger aur ek cola', delay: 700 },
  { id: 'b1', from: 'bot', text: '1x Zinger Burger, 1x Cola. Total Rs. 770. Confirm karun?', delay: 1400 },
  { id: 'c2', from: 'customer', text: 'yes', delay: 1300 },
  { id: 'b2', from: 'bot', text: 'Order #148 confirmed. Ready in about 25 minutes.', delay: 1200 },
];

const STAGES = ['New', 'Preparing', 'Ready'];

export default function HeroChatDemo() {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? SCRIPT.length : 0);
  const [stage, setStage] = useState(reduce ? 0 : -1); // -1: no ticket yet
  const timers = useRef([]);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const play = useCallback(() => {
    clear();
    setShown(0);
    setStage(-1);
    let t = 0;
    SCRIPT.forEach((m, i) => {
      t += m.delay;
      timers.current.push(setTimeout(() => setShown(i + 1), t));
    });
    timers.current.push(setTimeout(() => setStage(0), t + 700));
  }, []);

  useEffect(() => {
    if (reduce) return undefined;
    play();
    return clear;
  }, [reduce, play]);

  const advance = () => setStage((s) => (s < STAGES.length - 1 ? s + 1 : s));
  const done = stage === STAGES.length - 1;

  return (
    <div className="grid w-full gap-4 sm:grid-cols-[1.15fr_0.85fr]" aria-label="Sample WhatsApp order flowing to the kitchen">
      {/* WhatsApp-style chat */}
      <div className="flex min-h-[340px] flex-col overflow-hidden border border-[#d9d9d9] bg-white">
        <div className="flex items-center gap-2 bg-[#15803d] px-4 py-3 text-white">
          <span className="flex h-8 w-8 items-center justify-center bg-white/20"><ChefHat className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-semibold leading-tight">RestoAI Order Bot</p>
            <p className="text-[11px] leading-tight text-white/85">Sample order</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-2 bg-[#efeae2] p-3">
          <AnimatePresence initial={false}>
            {SCRIPT.slice(0, shown).map((m) => (
              <motion.div
                key={m.id}
                layout
                initial={reduce ? false : { opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className={`max-w-[85%] px-3 py-2 text-[13px] leading-snug text-[#111] ${
                  m.from === 'customer' ? 'self-end bg-[#d9fdd3]' : 'self-start bg-white'
                }`}
              >
                {m.text}
              </motion.div>
            ))}
          </AnimatePresence>
          {!reduce && shown < SCRIPT.length && shown > 0 && (
            <div className="flex self-start gap-1 bg-white px-3 py-2" aria-hidden="true">
              {[0, 1, 2].map((d) => (
                <motion.span key={d} className="h-1.5 w-1.5 bg-[#555]" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }} />
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-[#d9d9d9] bg-white px-3 py-2">
          <span className="flex-1 text-xs text-[#767676]">Type an order message</span>
          <Send className="h-4 w-4 text-[#15803d]" aria-hidden="true" />
        </div>
      </div>

      {/* Kitchen ticket */}
      <div className="flex min-h-[340px] flex-col border border-[#d9d9d9] bg-[#f4f4f4] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-[#555]">Kitchen display</p>
        <div className="mt-3 flex flex-1 flex-col">
          <AnimatePresence mode="wait">
            {stage < 0 ? (
              <motion.p key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="m-auto text-center text-sm text-[#555]">
                Waiting for the next order
              </motion.p>
            ) : (
              <motion.div
                key="ticket"
                initial={reduce ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="border-t-4 border-[#15803d] bg-white p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-2xl font-black tracking-tight">#148</span>
                  <span className="bg-[#111] px-2 py-1 text-[11px] font-semibold uppercase tracking-[1px] text-white">WhatsApp</span>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-[#111]">
                  <li>1x Zinger Burger</li>
                  <li>1x Cola</li>
                </ul>
                <div className="mt-4 flex gap-1" role="list" aria-label="Order status">
                  {STAGES.map((s, i) => (
                    <div key={s} role="listitem" className="flex-1">
                      <div className={`h-1.5 transition-colors duration-300 ${i <= stage ? 'bg-[#15803d]' : 'bg-[#d9d9d9]'}`} />
                      <p className={`mt-1 text-[11px] font-semibold ${i === stage ? 'text-[#15803d]' : 'text-[#555]'}`}>{s}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={advance}
                  disabled={done}
                  className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 bg-[#111] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#15803d] disabled:bg-[#15803d]"
                >
                  {done ? (<><Check className="h-4 w-4" /> Ready to serve</>) : `Mark ${STAGES[stage + 1].toLowerCase()}`}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button type="button" onClick={play} className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 text-sm font-semibold text-[#15803d] hover:text-[#111]">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Replay
        </button>
      </div>
    </div>
  );
}
