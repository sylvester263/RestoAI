/**
 * Super Admin Authentication (impl-29)
 *
 * Handles three states:
 * 1. Login form (email + password)
 * 2. MFA verification (TOTP code entry — when totp_enabled=true)
 * 3. MFA setup (QR code + verification — first login, totp_enabled=false)
 *
 * On successful auth, stores the session JWT in localStorage('superAdminToken')
 * and calls onAuthenticated() to switch to the main app.
 */
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { superAdminApi } from './superAdminApi';
import { Shield, LogIn, Key, Smartphone } from 'lucide-react';

export default function SuperAdminAuth({ onAuthenticated }) {
  const [step, setStep] = useState('login'); // 'login' | 'mfa_verify' | 'mfa_setup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaPendingToken, setMfaPendingToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await superAdminApi.loginStep1(email, password);
      setMfaPendingToken(data.mfaToken);

      if (data.totpEnabled) {
        // TOTP already enrolled — go to verification step
        setStep('mfa_verify');
      } else {
        // First login — go to TOTP setup
        const setupData = await superAdminApi.setupMfaPhase1(data.mfaPendingToken);
        setTotpSecret(setupData.secret);
        setTotpUri(setupData.uri);
        setStep('mfa_setup');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await superAdminApi.loginStep2(mfaPendingToken, totpCode);
      localStorage.setItem('superAdminToken', data.token);
      onAuthenticated(data.admin);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSetup(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await superAdminApi.setupMfaPhase2(mfaPendingToken, totpSecret, totpCode);
      // TOTP is now enabled — proceed to login step 2
      const data = await superAdminApi.loginStep2(mfaPendingToken, totpCode);
      localStorage.setItem('superAdminToken', data.token);
      onAuthenticated(data.admin);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-900/30 mb-4">
            <Shield className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">RestoAI Super Admin</h1>
          <p className="text-gray-400 mt-1">Platform management console</p>
        </div>

        <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-gray-700">
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                  autoFocus
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded transition-colors disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                {loading ? 'Verifying...' : 'Sign In'}
              </button>
            </form>
          )}

          {step === 'mfa_verify' && (
            <form onSubmit={handleMfaVerify}>
              <div className="text-center mb-4">
                <Smartphone className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-300 text-sm">Enter the 6-digit code from your authenticator app</p>
              </div>
              <div className="mb-6">
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-3 py-3 bg-gray-700 border border-gray-600 rounded text-white text-center text-2xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded transition-colors disabled:opacity-50"
              >
                <Key className="w-4 h-4" />
                {loading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('login'); setError(''); setTotpCode(''); }}
                className="w-full mt-2 text-sm text-gray-400 hover:text-gray-300"
              >
                Back to login
              </button>
            </form>
          )}

          {step === 'mfa_setup' && (
            <form onSubmit={handleMfaSetup}>
              <div className="text-center mb-4">
                <p className="text-gray-300 text-sm mb-3">
                  Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                </p>
                {totpUri && (
                  <div className="bg-white p-4 rounded-lg inline-block mb-3">
                    <QRCodeSVG value={totpUri} size={200} />
                  </div>
                )}
                <p className="text-xs text-gray-500 break-all">
                  Or enter this key manually: <code className="text-gray-400">{totpSecret}</code>
                </p>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Enter the 6-digit code to verify
                </label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-3 py-3 bg-gray-700 border border-gray-600 rounded text-white text-center text-2xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded transition-colors disabled:opacity-50"
              >
                <Shield className="w-4 h-4" />
                {loading ? 'Enabling...' : 'Enable MFA & Sign In'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
