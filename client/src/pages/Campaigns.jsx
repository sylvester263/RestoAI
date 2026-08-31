import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toast, confirmAction } from '../components/ui/toast';
import { Skeleton } from '../components/ui/Skeleton';
import Modal from '../components/ui/Modal';
import { Megaphone, Plus, Send, Users, CheckCircle2, XCircle, Clock, Eye, Loader2 } from 'lucide-react';

const STATUS_COLORS = {
  draft: 'bg-[var(--surface-3)] text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', message_template: '' });
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState(null);
  const [actionLoading, setActionLoading] = useState('');
  const [recipientPickerFor, setRecipientPickerFor] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getCampaigns();
      setCampaigns(res.campaigns);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!form.name || !form.message_template) return;
    try {
      await api.createCampaign(form);
      setShowForm(false);
      setForm({ name: '', message_template: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleAddRecipients(id, body) {
    setActionLoading('recipients-' + id);
    try {
      const res = await api.addRecipients(id, body);
      toast.success(`Added ${res.added} recipients`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleSend(id) {
    const ok = await confirmAction('Send this campaign to all recipients?');
    if (!ok) return;
    setActionLoading('send-' + id);
    try {
      await api.sendCampaign(id);
      load();
      pollCampaignStatus(id);
    } catch (err) {
      toast.error(err.message);
      setActionLoading('');
    }
  }

  // Sending happens in the background on the server, so poll until the
  // campaign leaves the 'sending' state instead of waiting on one long request.
  function pollCampaignStatus(id) {
    const interval = setInterval(async () => {
      try {
        const res = await api.getCampaignStatus(id);
        load();
        if (res.campaign.status !== 'sending') {
          clearInterval(interval);
          setActionLoading('');
        }
      } catch {
        clearInterval(interval);
        setActionLoading('');
      }
    }, 3000);
  }

  async function handleViewStatus(campaign) {
    setSelected(campaign);
    try {
      const res = await api.getCampaignStatus(campaign.id);
      setStats(res.stats);
    } catch (err) {
      console.error(err);
    }
  }

  // Preview the message with a sample name
  const previewMessage = form.message_template.replace(/\{\{name\}\}/g, 'Ahmed');

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Campaigns</h1>
          <p className="text-sm text-[var(--text-secondary)]">WhatsApp broadcast marketing</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Campaign
        </button>
      </div>

      {loading ? (
        <Skeleton.List rows={4} />
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--text-tertiary)]">
          <Megaphone className="mb-4 h-16 w-16" />
          <p className="text-lg font-medium">No campaigns yet</p>
          <p className="text-sm">Create your first broadcast to reach all customers.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-[var(--text-primary)]">{c.name}</h3>
                    <span className={`badge ${STATUS_COLORS[c.status] || ''}`}>{c.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-secondary)] line-clamp-1">{c.message_template}</p>
                  <div className="mt-2 flex items-center gap-4 text-xs text-[var(--text-tertiary)]">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.total_recipients || 0} recipients</span>
                    {c.sent_count > 0 && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" /> {c.sent_count} sent</span>}
                    {c.failed_count > 0 && <span className="flex items-center gap-1 text-red-600"><XCircle className="h-3 w-3" /> {c.failed_count} failed</span>}
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleViewStatus(c)} className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-3)]" title="View details">
                    <Eye className="h-4 w-4" />
                  </button>
                  {c.status === 'draft' && (
                    <>
                      <button
                        onClick={() => setRecipientPickerFor(c.id)}
                        disabled={actionLoading === 'recipients-' + c.id}
                        className="btn-secondary text-xs"
                      >
                        {actionLoading === 'recipients-' + c.id ? '...' : 'Add Recipients'}
                      </button>
                      <button
                        onClick={() => handleSend(c.id)}
                        disabled={actionLoading === 'send-' + c.id || !c.total_recipients}
                        className="btn-primary flex items-center gap-1 text-xs"
                      >
                        <Send className="h-3 w-3" />
                        {actionLoading === 'send-' + c.id ? 'Sending...' : 'Send'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create campaign modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Broadcast Campaign" size="lg">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Campaign Name</label>
            <input className="input" placeholder="e.g. Weekend Special Offer" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Message Template</label>
            <p className="mb-2 text-xs text-[var(--text-tertiary)]">Use <code className="rounded bg-[var(--surface-3)] px-1 py-0.5 text-xs">{'{{name}}'}</code> for customer's name</p>
            <textarea
              className="input min-h-[120px]"
              placeholder="Hi {{name}}! This weekend enjoy 20% off on all Karahi dishes. Order now!"
              value={form.message_template}
              onChange={(e) => setForm({ ...form, message_template: e.target.value })}
            />
          </div>
          {previewMessage && form.message_template && (
            <div className="rounded-lg bg-green-50 p-3">
              <p className="mb-1 text-xs font-medium text-green-700">Preview (as seen by customer):</p>
              <p className="text-sm whitespace-pre-wrap text-green-900">{previewMessage}</p>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleCreate} disabled={!form.name || !form.message_template} className="btn-primary">Create Campaign</button>
        </div>
      </Modal>

      {/* Recipient source picker */}
      {recipientPickerFor && (
        <RecipientPickerModal
          onClose={() => setRecipientPickerFor(null)}
          onPick={(body) => { handleAddRecipients(recipientPickerFor, body); setRecipientPickerFor(null); }}
        />
      )}

      {/* Status detail modal */}
      <Modal open={!!(selected && stats)} onClose={() => { setSelected(null); setStats(null); }} title={selected?.name || ''}>
        <span className={`badge mb-4 inline-block ${STATUS_COLORS[selected?.status] || ''}`}>{selected?.status}</span>
        <div className="mb-4 rounded-lg bg-[var(--surface-3)] p-3">
          <p className="text-sm whitespace-pre-wrap text-[var(--text-secondary)]">{selected?.message_template}</p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Total recipients</span><span className="font-semibold">{stats?.pending + stats?.sent + stats?.failed + stats?.skipped_no_window}</span></div>
          <div className="flex justify-between text-green-600"><span>Sent</span><span className="font-semibold">{stats?.sent}</span></div>
          <div className="flex justify-between text-red-600"><span>Failed</span><span className="font-semibold">{stats?.failed}</span></div>
          <div className="flex justify-between text-[var(--text-tertiary)]"><span>Pending</span><span className="font-semibold">{stats?.pending}</span></div>
          {stats?.skipped_no_window > 0 && (
            <div className="flex justify-between text-yellow-600"><span>Skipped (outside window)</span><span className="font-semibold">{stats.skipped_no_window}</span></div>
          )}
        </div>
        <div className="mt-6 flex justify-end">
          <button onClick={() => { setSelected(null); setStats(null); }} className="btn-secondary">Close</button>
        </div>
      </Modal>
    </div>
  );
}

function RecipientPickerModal({ onClose, onPick }) {
  const [source, setSource] = useState('all'); // 'all' | 'segment' | 'rfm'
  const [segments, setSegments] = useState([]);
  const [segmentId, setSegmentId] = useState('');
  const [rfmSummary, setRfmSummary] = useState([]);
  const [rfmLabel, setRfmLabel] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getSegments(), api.getRfmSegments()])
      .then(([segRes, rfmRes]) => {
        setSegments(segRes.segments);
        setRfmSummary(rfmRes.summary);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleConfirm() {
    if (source === 'segment' && segmentId) return onPick({ segment_id: segmentId });
    if (source === 'rfm' && rfmLabel) return onPick({ rfm_label: rfmLabel });
    onPick({});
  }

  const confirmDisabled = (source === 'segment' && !segmentId) || (source === 'rfm' && !rfmLabel);

  return (
    <Modal open={true} onClose={onClose} title="Choose recipients">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
            <input type="radio" name="source" checked={source === 'all'} onChange={() => setSource('all')} />
            All customers
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
            <input type="radio" name="source" checked={source === 'segment'} onChange={() => setSource('segment')} disabled={segments.length === 0} />
            A saved segment {segments.length === 0 && <span className="text-xs text-[var(--text-tertiary)]">(none yet)</span>}
          </label>
          {source === 'segment' && (
            <select className="input ml-6 w-[calc(100%-1.5rem)]" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              <option value="">Select a segment…</option>
              {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}

          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
            <input type="radio" name="source" checked={source === 'rfm'} onChange={() => setSource('rfm')} />
            An RFM segment
          </label>
          {source === 'rfm' && (
            <select className="input ml-6 w-[calc(100%-1.5rem)]" value={rfmLabel} onChange={(e) => setRfmLabel(e.target.value)}>
              <option value="">Select a segment…</option>
              {rfmSummary.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.count})</option>)}
            </select>
          )}
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleConfirm} disabled={loading || confirmDisabled} className="btn-primary">Add Recipients</button>
      </div>
    </Modal>
  );
}
