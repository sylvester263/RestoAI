import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import {
  Sparkles, UserX, ShieldAlert, Wallet, Bike, ToggleLeft, ToggleRight,
} from 'lucide-react';

const SEVERITY_STYLES = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

export default function Agents() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [settings, setSettings] = useState(null);
  const [lapsed, setLapsed] = useState([]);
  const [reconFlags, setReconFlags] = useState([]);
  const [abuseFlags, setAbuseFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const [lapsedRes, reconRes, abuseRes] = await Promise.all([
        api.getWinbackPreview(),
        api.getReconciliationFlags('open'),
        api.getAbuseFlags('open'),
      ]);
      setLapsed(lapsedRes.customers);
      setReconFlags(reconRes.flags);
      setAbuseFlags(abuseRes.flags);
      if (isOwner) {
        const settingsRes = await api.getAgentSettings();
        setSettings(settingsRes);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => { load(); }, [load]);

  async function toggleWinback() {
    setSavingSettings(true);
    try {
      const updated = await api.updateAgentSettings({ winback_enabled: !settings.winback_enabled });
      setSettings(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function setDispatchMode(mode) {
    setSavingSettings(true);
    try {
      const updated = await api.updateAgentSettings({ dispatch_mode: mode });
      setSettings(updated);
      toast.success('Dispatch mode updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleReconStatus(id, status) {
    try {
      await api.updateReconciliationFlagStatus(id, status);
      setReconFlags((flags) => flags.filter((f) => f.id !== id));
      toast.success('Flag updated');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleAbuseStatus(id, status) {
    try {
      await api.updateAbuseFlagStatus(id, status);
      setAbuseFlags((flags) => flags.filter((f) => f.id !== id));
      toast.success('Flag updated');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <div className="space-y-6"><Skeleton className="h-8 w-40" /><div className="grid gap-6 lg:grid-cols-2"><Skeleton.Card /><Skeleton.Card /></div></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Sparkles className="h-6 w-6 text-brand-600" /> AI Agents
        </h1>
        <p className="text-sm text-gray-500">Proactive automation running behind the scenes — review what it found and control what it's allowed to do.</p>
      </div>

      {isOwner && settings && (
        <div className="card mb-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><Bike className="h-4 w-4" /> Automation controls</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Win-back messages</p>
                <p className="text-xs text-gray-500">Auto-message customers who've gone quiet</p>
              </div>
              <button onClick={toggleWinback} disabled={savingSettings} className="text-brand-600">
                {settings.winback_enabled ? <ToggleRight className="h-7 w-7" /> : <ToggleLeft className="h-7 w-7 text-gray-300" />}
              </button>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="mb-2 text-sm font-medium text-gray-900">Rider dispatch</p>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setDispatchMode('suggest_only')}
                  disabled={savingSettings}
                  className={`rounded-lg px-3 py-1.5 font-medium ${settings.dispatch_mode === 'suggest_only' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                >
                  Suggest only
                </button>
                <button
                  onClick={() => setDispatchMode('auto')}
                  disabled={savingSettings}
                  className={`rounded-lg px-3 py-1.5 font-medium ${settings.dispatch_mode === 'auto' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                >
                  Full auto-assign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Win-back preview */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><UserX className="h-4 w-4" /> Win-Back Preview</h2>
          <p className="mb-3 text-xs text-gray-500">Customers who'd be messaged on the next scheduled run.</p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {lapsed.length === 0 && <p className="text-sm text-gray-400">No lapsed customers right now</p>}
            {lapsed.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-gray-900">{c.name || c.phone}</p>
                  <span className="badge bg-amber-100 text-amber-700">{c.days_since_last_order}d quiet</span>
                </div>
                <p className="text-xs text-gray-500">{c.phone}{c.favorite_item ? ` · usually orders ${c.favorite_item}` : ''}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Reconciliation flags */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><Wallet className="h-4 w-4" /> Payment Reconciliation</h2>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {reconFlags.length === 0 && <p className="text-sm text-gray-400">No open flags</p>}
            {reconFlags.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`badge ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
                  {f.order_number && <span className="text-xs text-gray-400">Order #{f.order_number}</span>}
                </div>
                <p className="mb-2 text-gray-700">{f.description}</p>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => handleReconStatus(f.id, 'resolved')} className="font-medium text-green-600 hover:underline">Resolve</button>
                  <button onClick={() => handleReconStatus(f.id, 'dismissed')} className="font-medium text-gray-500 hover:underline">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Abuse flags */}
        <div className="card lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><ShieldAlert className="h-4 w-4" /> Pattern Flags for Review</h2>
          <p className="mb-3 text-xs text-gray-500">Surfaced for human judgment — nothing here is ever auto-blocked or auto-cancelled.</p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {abuseFlags.length === 0 && <p className="text-sm text-gray-400">No open flags</p>}
            {abuseFlags.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`badge ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
                  <span className="text-xs uppercase tracking-wide text-gray-400">{f.flag_type.replace('_', ' ')}</span>
                </div>
                <p className="mb-2 text-gray-700">{f.description}</p>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => handleAbuseStatus(f.id, 'confirmed')} className="font-medium text-red-600 hover:underline">Confirm</button>
                  <button onClick={() => handleAbuseStatus(f.id, 'false_positive')} className="font-medium text-gray-500 hover:underline">False positive</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
