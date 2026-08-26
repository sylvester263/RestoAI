import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicApi } from '../../lib/api';
import { getIdentity } from '../../lib/publicOrderStore';
import { ArrowLeft, Gift, Loader2 } from 'lucide-react';

export default function Loyalty() {
  const { tenantSlug } = useParams();
  const [phone, setPhone] = useState(getIdentity(tenantSlug)?.phone || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (phone.trim().length >= 7) handleCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCheck(e) {
    e?.preventDefault();
    if (phone.trim().length < 7) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await publicApi.getLoyaltyBalance(tenantSlug, phone.trim());
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <Link to={`/order/${tenantSlug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Back to menu
        </Link>

        <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Gift className="h-6 w-6 text-brand-600" /> Loyalty points
        </h1>
        <p className="mb-6 text-sm text-gray-500">Check your points balance using the phone number you order with.</p>

        <form onSubmit={handleCheck} className="card mb-4 flex gap-3">
          <input
            className="input flex-1"
            placeholder="+92300..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button type="submit" disabled={loading} className="btn-primary shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check'}
          </button>
        </form>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {result && !result.enabled && (
          <div className="card text-sm text-gray-500">This restaurant doesn't have a loyalty program yet.</div>
        )}

        {result && result.enabled && (
          <div className="card text-center">
            <p className="text-4xl font-bold text-brand-600">{result.balance}</p>
            <p className="mt-1 text-sm text-gray-500">points available</p>
            <p className="mt-3 text-xs text-gray-400">
              Worth Rs. {(Math.round(result.balance * result.redemption_rate * 100) / 100).toLocaleString()} off your next order — redeem it at checkout.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
