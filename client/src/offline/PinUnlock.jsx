/**
 * Offline PIN unlock on the sign-in screen (impl-33 Part 4). Lists the people
 * set up on this device; their PIN is checked against the local PBKDF2 hash,
 * so it works with no connection. Wrong PINs lock the person out for a while
 * (counted in IndexedDB, so restarting the browser doesn't reset it).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { listEnrollments, verifyPin } from './pin';

export function usePinEnrollments() {
  const [list, setList] = useState(null);
  useEffect(() => {
    listEnrollments().then(setList).catch(() => setList([]));
  }, []);
  return list;
}

export default function PinUnlock({ enrollments, onCancel }) {
  const { loginOffline } = useAuth();
  const navigate = useNavigate();
  const [who, setWho] = useState(enrollments.length === 1 ? enrollments[0] : null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await verifyPin(who.user_id, pin);
      setPin('');
      if (res.ok) {
        loginOffline(res.record);
        navigate('/pos');
        return;
      }
      if (res.reason === 'locked') {
        setMessage(`Too many wrong PINs. Try again after ${new Date(res.lockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
      } else if (res.reason === 'wrong') {
        setMessage(`Wrong PIN. ${res.attemptsLeft} attempt${res.attemptsLeft === 1 ? '' : 's'} left before a lockout.`);
      } else {
        setMessage('This person is no longer set up on this device.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="pin-unlock">
      <button type="button" onClick={onCancel} className="mb-4 flex items-center gap-1 text-sm text-[var(--text-secondary)]"><ArrowLeft className="h-4 w-4" /> Sign in with email instead</button>
      {!who ? (
        <div className="space-y-2">
          <p className="mb-2 text-sm text-[var(--text-secondary)]">Who&apos;s on the till?</p>
          {enrollments.map((r) => (
            <button key={r.user_id} type="button" onClick={() => setWho(r)} className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-left text-sm hover:border-brand-400">
              <KeyRound className="h-4 w-4" /> {r.name} <span className="text-xs text-[var(--text-tertiary)]">{r.tenant?.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit}>
          <p className="mb-2 text-sm text-[var(--text-secondary)]">PIN for <span className="font-medium text-[var(--text-primary)]">{who.name}</span>
            {enrollments.length > 1 && <button type="button" onClick={() => { setWho(null); setMessage(''); }} className="ml-2 text-xs text-brand-600">change</button>}
          </p>
          <input className="input mb-3 text-center text-2xl tracking-[0.5em]" type="password" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} data-testid="pin-input" aria-label="PIN" />
          {message && <p className="mb-3 text-sm text-red-600" role="alert" data-testid="pin-message">{message}</p>}
          <button type="submit" disabled={busy || pin.length < 4} className="btn-primary w-full justify-center" data-testid="pin-submit">{busy ? 'Checking…' : 'Unlock till'}</button>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">A PIN session can sell for cash only. Card payments, discounts, voids and everything else need a full sign-in.</p>
        </form>
      )}
    </div>
  );
}
