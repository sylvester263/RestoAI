import { useState } from 'react';
import { motion } from 'framer-motion';
import { formatRs } from '../../../lib/pricing';
import useCountUp from './useCountUp';

function Slider({ id, label, value, min, max, step, onChange, display }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-white">{label}</label>
        <output htmlFor={id} className="font-display text-xl font-black tracking-tight text-[#4ade80]">{display}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-2 w-full cursor-pointer appearance-none bg-[#333] accent-[#22c55e]"
        style={{ backgroundImage: `linear-gradient(to right, #22c55e ${pct}%, #333 ${pct}%)` }}
      />
    </div>
  );
}

// Everything on this card is arithmetic on the visitor's own inputs; the
// defaults are placeholders, not a statistic about any restaurant.
export default function CommissionCalculator({ planMonthly }) {
  const [orders, setOrders] = useState(800);
  const [bill, setBill] = useState(1200);
  const [rate, setRate] = useState(30);
  const [moved, setMoved] = useState(40);

  const monthlySales = orders * bill;
  const commission = monthlySales * (rate / 100);
  const saved = commission * (moved / 100);

  const shownCommission = useCountUp(commission);
  const shownSaved = useCountUp(saved);

  return (
    <div className="grid gap-px bg-[#333] lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-7 bg-[#111] p-6 sm:p-8">
        <Slider id="calc-orders" label="Aggregator orders per month" value={orders} min={100} max={5000} step={50} onChange={setOrders} display={orders.toLocaleString('en-PK')} />
        <Slider id="calc-bill" label="Average bill" value={bill} min={400} max={4000} step={50} onChange={setBill} display={formatRs(bill)} />
        <Slider id="calc-rate" label="Commission you pay" value={rate} min={10} max={35} step={1} onChange={setRate} display={`${rate}%`} />
        <Slider id="calc-moved" label="Orders you could move to WhatsApp and your own site" value={moved} min={10} max={100} step={5} onChange={setMoved} display={`${moved}%`} />
      </div>

      <div className="flex flex-col justify-between gap-6 bg-[#15803d] p-6 text-white sm:p-8">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-white">Commission paid each month</p>
          <p className="mt-2 font-display text-4xl font-black tracking-tight sm:text-5xl" aria-live="polite">{formatRs(Math.round(shownCommission))}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-white">Kept each month by moving {moved}%</p>
          <motion.p key={saved} initial={{ scale: 0.98 }} animate={{ scale: 1 }} className="mt-2 font-display text-5xl font-black tracking-tight sm:text-6xl">
            {formatRs(Math.round(shownSaved))}
          </motion.p>
          {planMonthly != null && (
            <p className="mt-3 text-sm text-white">
              {saved > planMonthly
                ? `That is ${(saved / planMonthly).toFixed(1)}x the ${formatRs(planMonthly)} Starter plan.`
                : `Starter plan is ${formatRs(planMonthly)} a month.`}
            </p>
          )}
        </div>
        <p className="text-xs leading-relaxed text-white">
          Illustration using the numbers you enter. Your own commission rate and order mix will differ.
        </p>
      </div>
    </div>
  );
}
