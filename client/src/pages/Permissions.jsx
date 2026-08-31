import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ShieldCheck, Loader2, Check } from 'lucide-react';

export default function Permissions() {
  const [permissions, setPermissions] = useState([]);
  const [grants, setGrants] = useState({ manager: [], staff: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPermissions()
      .then((res) => {
        setPermissions(res.permissions);
        setGrants(res.grants);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(role, key) {
    setSaved(false);
    setGrants((g) => {
      const current = g[role];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...g, [role]: next };
    });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await Promise.all([
        api.updateRolePermissions('manager', grants.manager),
        api.updateRolePermissions('staff', grants.staff),
      ]);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-[var(--text-tertiary)]">Loading permissions...</div>;
  if (error && permissions.length === 0) {
    return <div className="py-20 text-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]"><ShieldCheck className="h-6 w-6 text-brand-600" /> Staff Permissions</h1>
          <p className="text-sm text-[var(--text-secondary)]">Choose what Manager and Staff accounts can do. Owner always has full access.</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <><Check className="h-4 w-4" /> Saved</> : 'Save Changes'}
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-light)] text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              <th className="py-3 pr-4">Permission</th>
              <th className="w-24 py-3 text-center">Owner</th>
              <th className="w-24 py-3 text-center">Manager</th>
              <th className="w-24 py-3 text-center">Staff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-light)]">
            {permissions.map((p) => (
              <tr key={p.key}>
                <td className="py-3 pr-4">
                  <p className="font-medium text-[var(--text-primary)]">{p.key}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{p.description}</p>
                </td>
                <td className="text-center">
                  <input type="checkbox" checked disabled className="h-4 w-4 cursor-not-allowed rounded border-[var(--border)] opacity-50" />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={grants.manager.includes(p.key)}
                    onChange={() => toggle('manager', p.key)}
                    className="h-4 w-4 cursor-pointer rounded border-[var(--border)] text-brand-600"
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={grants.staff.includes(p.key)}
                    onChange={() => toggle('staff', p.key)}
                    className="h-4 w-4 cursor-pointer rounded border-[var(--border)] text-brand-600"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
