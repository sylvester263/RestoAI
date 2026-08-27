import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { riderApi } from '../../lib/api';
import { Bike } from 'lucide-react';

export default function RiderLogin() {
  const { tenantSlug: slugFromUrl } = useParams();
  const navigate = useNavigate();
  const [tenantSlug, setTenantSlug] = useState(slugFromUrl || '');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await riderApi.login(tenantSlug.trim().toLowerCase(), phone.trim(), pin.trim());
      localStorage.setItem('riderToken', res.token);
      localStorage.setItem('riderInfo', JSON.stringify(res.rider));
      navigate('/rider');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600">
            <Bike className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Rider login</h1>
          <p className="mt-1 text-sm text-gray-500">Enter the restaurant code, your phone number, and your PIN.</p>
        </div>

        <div className="card">
          {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Restaurant code</label>
              <input
                className="input"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="e.g. lahore-karahi-house"
                disabled={!!slugFromUrl}
                required
              />
              <p className="mt-1 text-xs text-gray-400">Ask your manager for this if you don't have it.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Phone number</label>
              <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">PIN</label>
              <input
                className="input tracking-widest"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
