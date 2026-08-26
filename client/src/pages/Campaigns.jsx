import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Megaphone, Plus, Send, Users, CheckCircle2, XCircle, Clock, Eye } from 'lucide-react';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
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
      alert(err.message);
    }
  }

  async function handleAddRecipients(id) {
    setActionLoading('recipients-' + id);
    try {
      const res = await api.addRecipients(id);
      alert(`Added ${res.added} recipients`);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleSend(id) {
    if (!confirm('Send this campaign to all recipients?')) return;
    setActionLoading('send-' + id);
    try {
      await api.sendCampaign(id);
      load();
      pollCampaignStatus(id);
    } catch (err) {
      alert(err.message);
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
          <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-500">WhatsApp broadcast marketing</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Campaign
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-400">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
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
                    <h3 className="font-semibold text-gray-900">{c.name}</h3>
                    <span className={`badge ${STATUS_COLORS[c.status] || ''}`}>{c.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 line-clamp-1">{c.message_template}</p>
                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.total_recipients || 0} recipients</span>
                    {c.sent_count > 0 && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" /> {c.sent_count} sent</span>}
                    {c.failed_count > 0 && <span className="flex items-center gap-1 text-red-600"><XCircle className="h-3 w-3" /> {c.failed_count} failed</span>}
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleViewStatus(c)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" title="View details">
                    <Eye className="h-4 w-4" />
                  </button>
                  {c.status === 'draft' && (
                    <>
                      <button
                        onClick={() => handleAddRecipients(c.id)}
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
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="w-[32rem] rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">New Broadcast Campaign</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Campaign Name</label>
                <input className="input" placeholder="e.g. Weekend Special Offer" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Message Template</label>
                <p className="mb-2 text-xs text-gray-400">Use <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{'{{name}}'}</code> for customer's name</p>
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
          </div>
        </div>
      )}

      {/* Status detail modal */}
      {selected && stats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setSelected(null); setStats(null); }}>
          <div className="w-96 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold">{selected.name}</h3>
            <span className={`badge mb-4 inline-block ${STATUS_COLORS[selected.status] || ''}`}>{selected.status}</span>
            <div className="mb-4 rounded-lg bg-gray-50 p-3">
              <p className="text-sm whitespace-pre-wrap text-gray-700">{selected.message_template}</p>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Total recipients</span><span className="font-semibold">{stats.pending + stats.sent + stats.failed + stats.skipped_no_window}</span></div>
              <div className="flex justify-between text-green-600"><span>Sent</span><span className="font-semibold">{stats.sent}</span></div>
              <div className="flex justify-between text-red-600"><span>Failed</span><span className="font-semibold">{stats.failed}</span></div>
              <div className="flex justify-between text-gray-400"><span>Pending</span><span className="font-semibold">{stats.pending}</span></div>
              {stats.skipped_no_window > 0 && (
                <div className="flex justify-between text-yellow-600"><span>Skipped (outside window)</span><span className="font-semibold">{stats.skipped_no_window}</span></div>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={() => { setSelected(null); setStats(null); }} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
