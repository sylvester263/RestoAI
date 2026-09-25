import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Skeleton } from '../components/ui/Skeleton';
import Modal from '../components/ui/Modal';
import { toast, confirmAction } from '../components/ui/toast';
import { UserPlus, Plus, X, Loader2, Copy, Check, Clock, CheckCircle2, XCircle, Users } from 'lucide-react';

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-[var(--text-secondary)]',
};
const STATUS_ICON = { pending: Clock, accepted: CheckCircle2, expired: XCircle };

export default function Staff() {
  const [invites, setInvites] = useState([]);
  const [staff, setStaff] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState('');

  function load() {
    Promise.all([api.getStaff(), api.getStaffInvites(), api.getBranches()])
      .then(([staffRes, invitesRes, branchesRes]) => {
        setStaff(staffRes.staff);
        setInvites(invitesRes.invites);
        setBranches(branchesRes.branches);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function setAccess(member, active) {
    if (!active) {
      const ok = await confirmAction(
        `Remove ${member.name}?`,
        "They'll be signed out and won't be able to log in. Their past orders and actions stay on record, and you can restore access later.",
      );
      if (!ok) return;
    }
    setBusyId(member.id);
    try {
      const res = active ? await api.reactivateStaff(member.id) : await api.deactivateStaff(member.id);
      setStaff((list) => list.map((m) => (m.id === member.id ? { ...m, deactivated_at: res.user.deactivated_at } : m)));
      toast.success(active ? `${member.name} can sign in again` : `${member.name} has been removed`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="space-y-6"><Skeleton className="h-8 w-24" /><Skeleton.Table rows={4} cols={5} /></div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]"><UserPlus className="h-6 w-6 text-brand-600" /> Staff</h1>
          <p className="text-sm text-[var(--text-secondary)]">Invite managers and staff — they sign in through the same login as you.</p>
        </div>
        <button onClick={() => setShowInvite(true)} className="btn-primary"><Plus className="h-4 w-4" /> Invite Staff</button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><Users className="h-5 w-5" /> Team</h2>
      <div className="card mb-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-light)] text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              <th className="py-3 pr-4">Name</th>
              <th className="py-3 pr-4">Role</th>
              <th className="py-3 pr-4">Branches</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4 text-right">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-light)]">
            {staff.map((m) => {
              const removed = !!m.deactivated_at;
              return (
                <tr key={m.id} className={removed ? 'opacity-60' : ''}>
                  <td className="py-3 pr-4">
                    <p className="font-medium text-[var(--text-primary)]">{m.name}{m.is_you && <span className="ml-1 text-xs text-[var(--text-tertiary)]">(you)</span>}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{m.email}</p>
                  </td>
                  <td className="py-3 pr-4 capitalize text-[var(--text-secondary)]">{m.role}</td>
                  <td className="py-3 pr-4 text-[var(--text-secondary)]">{m.role === 'owner' ? 'All branches' : (m.branches.length ? m.branches.join(', ') : 'None assigned')}</td>
                  <td className="py-3 pr-4">
                    {removed
                      ? <span className="badge bg-[var(--surface-3)] text-[var(--text-secondary)]">Removed {new Date(m.deactivated_at).toLocaleDateString()}</span>
                      : <span className="badge bg-green-100 text-green-700">Active</span>}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    {m.role !== 'owner' && !m.is_you && (
                      <button
                        type="button"
                        onClick={() => setAccess(m, removed)}
                        disabled={busyId === m.id}
                        className={removed ? 'btn-secondary !py-1 text-xs' : 'rounded-lg px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50'}
                      >
                        {busyId === m.id ? 'Saving…' : removed ? 'Restore access' : 'Remove'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Invites</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-light)] text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              <th className="py-3 pr-4">Email</th>
              <th className="py-3 pr-4">Role</th>
              <th className="py-3 pr-4">Branch</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4">Invited</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-light)]">
            {invites.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-[var(--text-tertiary)]">No invites sent yet</td></tr>
            )}
            {invites.map((inv) => {
              const Icon = STATUS_ICON[inv.status];
              return (
                <tr key={inv.id}>
                  <td className="py-3 pr-4 font-medium text-[var(--text-primary)]">{inv.email}</td>
                  <td className="py-3 pr-4 capitalize text-[var(--text-secondary)]">{inv.role}</td>
                  <td className="py-3 pr-4 text-[var(--text-secondary)]">{inv.branch_name || 'Any branch'}</td>
                  <td className="py-3 pr-4">
                    <span className={`badge ${STATUS_STYLE[inv.status]}`}><Icon className="mr-1 h-3 w-3" /> {inv.status}</span>
                  </td>
                  <td className="py-3 pr-4 text-[var(--text-secondary)]">{new Date(inv.created_at).toLocaleDateString()}</td>
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
    <Modal open={true} onClose={onClose} title="Invite Staff">
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
          <p className="mb-3 text-sm text-[var(--text-secondary)]">
            Invite created. {phone ? 'A WhatsApp message was sent (or logged, in demo mode) — you can also' : 'Share'} this link with {email} directly:
          </p>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-3)] px-3 py-2">
            <span className="truncate text-xs text-[var(--text-secondary)]">{inviteLink}</span>
            <button onClick={handleCopy} className="btn-secondary shrink-0 text-xs">
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
          </div>
          <button onClick={onCreated} className="btn-primary mt-4 w-full justify-center">Done</button>
        </>
      )}
    </Modal>
  );
}
