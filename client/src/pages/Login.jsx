import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { ChefHat, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', restaurantName: '', restaurantSlug: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = isRegister ? await api.register(form) : await api.login(form);
      login(res.token, res.user, res.tenant);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-gray-100 px-4">
      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg">
            <ChefHat className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">RestoAI</h1>
          <p className="mt-1 text-sm text-gray-500">AI-powered restaurant operations</p>
        </div>

        <div className="card">
          <h2 className="mb-6 text-lg font-semibold text-gray-900">
            {isRegister ? 'Create your restaurant' : 'Sign in to your account'}
          </h2>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Your Name</label>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Restaurant Name</label>
                  <input className="input" value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Restaurant Slug</label>
                  <input className="input" value={form.restaurantSlug} onChange={(e) => setForm({ ...form, restaurantSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="my-restaurant" required />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
              <div className="relative">
                <input className="input pr-10" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading ? 'Please wait...' : isRegister ? 'Create Restaurant' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-gray-500">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button onClick={() => setIsRegister(!isRegister)} className="font-medium text-brand-600 hover:text-brand-700">
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </div>

          {!isRegister && (
            <p className="mt-3 text-center text-xs text-gray-400">
              Demo: ahmed@karahi.pk / demo1234
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
