import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { UserPlus, Plus, X, Loader2, Copy, Check, Clock, CheckCircle2, XCircle } from 'lucide-react';

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
};
const STATUS_ICON = { pending: Clock, accepted: CheckCircle2, expired: XCircle };

export default function Staff() {
  const [invites, setInvites] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState('');

  function load() {
    Promise.all([api.getStaffInvites(), api.getBranches()])
      .then(([invitesRes, branchesRes]) => {
        setInvites(invitesRes.invites);
        setBranches(branchesRes.branches);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading staff...</div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><UserPlus className="h-6 w-6 text-brand-600" /> Staff</h1>
          <p className="text-sm text-gray-500">Invite managers and staff — they sign in through the same login as you.</p>
        </div>
        <button onClick={() => setShowInvite(true)} className="btn-primary"><Plus className="h-4 w-4" /> Invite Staff</button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="py-3 pr-4">Email</th>
              <th className="py-3 pr-4">Role</th>
              <th className="py-3 pr-4">Branch</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4">Invited</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invites.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">No invites sent yet</td></tr>
            )}
            {invites.map((inv) => {
              const Icon = STATUS_ICON[inv.status];
              return (
                <tr key={inv.id}>
                  <td className="py-3 pr-4 font-medium text-gray-900">{inv.email}</td>
                  <td className="py-3 pr-4 capitalize text-gray-600">{inv.role}</td>
                  <td className="py-3 pr-4 text-gray-600">{inv.branch_name || 'Any branch'}</td>
                  <td className="py-3 pr-4">
                    <span className={`badge ${STATUS_STYLE[inv.status]}`}><Icon className="mr-1 h-3 w-3" /> {inv.status}</span>
                  </td>
                  <td className="py-3 pr-4 text-gray-500">{new Date(inv.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <InviteModal branches={branches} onClose={() => setShowInvite(false)} onCreated={() => { setShowInvite(false); load(); }} />
      )}
    </div>
  );
}

function InviteModal({ branches, onClose, onCreated }) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('staff');
  const [branchId, setBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      const res = await api.createStaffInvite({
        email,
        phone: phone || undefined,
        role,
        branch_id: branchId || undefined,
      });
      setInviteLink(res.invite.invite_link);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    navigator.clipboard?.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Invite Staff</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        {!inviteLink ? (
          <>
            <div className="space-y-3">
              <input className="input" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="input" placeholder="Phone (optional — sends via WhatsApp)" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
              {branches.length > 1 && (
                <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">Any branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button onClick={handleCreate} disabled={saving || !email} className="btn-primary mt-4 w-full justify-center">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Invite'}
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-500">
              Invite created. {phone ? 'A WhatsApp message was sent (or logged, in demo mode) — you can also' : 'Share'} this link with {email} directly:
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="truncate text-xs text-gray-700">{inviteLink}</span>
              <button onClick={handleCopy} className="btn-secondary shrink-0 text-xs">
                {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
              </button>
            </div>
            <button onClick={onCreated} className="btn-primary mt-4 w-full justify-center">Done</button>
          </>
        )}
      </div>
    </div>
  );
}
