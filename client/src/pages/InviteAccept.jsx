import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { marketingApi } from '../lib/api';
import { ChefHat, CheckCircle2 } from 'lucide-react';

export default function InviteAccept() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await marketingApi.acceptStaffInvite(token, { name, password });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600">
            <ChefHat className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">RestoAI</h1>
          <p className="mt-1 text-sm text-gray-500">Set up your staff account</p>
        </div>

        <div className="card">
          {done ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
              <h2 className="mb-2 text-lg font-semibold text-gray-900">Account created</h2>
              <p className="mb-4 text-sm text-gray-500">You can now sign in with your email and password.</p>
              <Link to="/login" className="btn-primary w-full justify-center">Go to sign in</Link>
            </div>
          ) : (
            <>
              <h2 className="mb-6 text-lg font-semibold text-gray-900">Accept your invite</h2>
              {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Your name</label>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Choose a password</label>
                  <input className="input" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                  {loading ? 'Please wait...' : 'Create account'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
