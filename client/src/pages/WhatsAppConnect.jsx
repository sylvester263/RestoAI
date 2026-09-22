import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { MessageCircle, CheckCircle2, XCircle, Loader2, RefreshCw, Unlink, ArrowLeft, AlertTriangle, Mail } from 'lucide-react';

const FB_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const FB_SDK_VERSION = 'v21.0';

// Loads Meta's JS SDK exactly once per page (safe to call repeatedly).
function loadFacebookSdk(appId) {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = function fbAsyncInit() {
      window.FB.init({
        appId,
        xfbml: false,
        version: FB_SDK_VERSION,
        // Opt out of Chrome's FedCM login path. When FedCM is on (Meta's SDK
        // defaults it per app from a server-side config when this is unset),
        // FB.login() hands the request to the browser's FedCM API forwarding
        // ONLY `scope` — config_id, response_type and extras are dropped, so
        // Embedded Signup degrades into a generic openid login and Facebook
        // answers "This app needs at least one supported permission".
        // Embedded Signup needs the classic popup + WA_EMBEDDED_SIGNUP
        // postMessage events anyway. `fedCM: false` is read by the SDK's own
        // init code (connect.facebook.net/en_US/bundle/sdk.js, rev
        // 1048049033: fedCM === false -> setUseFedCM(false) +
        // setFedCMExplicitlySet(true)); it is NOT in Meta's FB.init reference
        // page, so re-check this if the SDK's behavior ever changes.
        fedCM: false,
      });
      resolve(window.FB);
    };
    if (document.getElementById('facebook-jssdk')) return; // script tag already inserted, fbAsyncInit will fire
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = FB_SDK_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Could not load the Facebook SDK — check your connection and try again.'));
    document.body.appendChild(script);
  });
}

const SUPPORT_EMAIL = 'support@restoai.app';

// Pre-check answers (impl-31). Embedded Signup only registers a number that
// has no active WhatsApp account, so owners with an existing account are told
// what Meta will require BEFORE the popup, not mid-flow.
//   new           -> A1: straight into Embedded Signup
//   whatsapp_app  -> A2: on personal WhatsApp / WhatsApp Business app
//   other_provider-> B:  already on Cloud API via another provider (assisted migration)
const PRECHECK_OPTIONS = [
  { value: 'new', label: "No, it's a new number", hint: 'Not used on any WhatsApp app yet' },
  { value: 'whatsapp_app', label: 'Yes, on regular WhatsApp or WhatsApp Business app', hint: 'The number has a WhatsApp account on a phone' },
  { value: 'other_provider', label: 'Yes, through another business messaging platform', hint: 'e.g. Wati, Gupshup, 360dialog, Twilio' },
];

const STATUS_LABEL = {
  not_connected: 'Not connected',
  connected: 'Connected',
  error: 'Connection error',
};

export default function WhatsAppConnect() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'error' | 'info', text }
  // null (closed) | 'ask' | 'whatsapp_app' | 'other_provider'
  const [precheck, setPrecheck] = useState(null);

  // Holds the signup-session pieces that arrive across two separate async
  // events (FB.login()'s callback gives `code`; a window postMessage gives
  // waba_id/phone_number_id) until both are in hand.
  const sessionRef = useRef({});

  async function refreshStatus() {
    setLoadingStatus(true);
    try {
      const res = await api.getWhatsAppConnectStatus();
      setStatus(res);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    function handleMessage(event) {
      if (!event.origin.endsWith('facebook.com')) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
        sessionRef.current.wabaId = data.data?.waba_id;
        sessionRef.current.phoneNumberId = data.data?.phone_number_id;
        maybeSubmitCallback();
      } else if (data.event === 'CANCEL') {
        setConnecting(false);
        if (data.data?.error_message) {
          setMessage({ type: 'error', text: `Signup was interrupted: ${data.data.error_message}` });
        }
        // A plain user-initiated cancel (no error_message) — nothing to show.
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function maybeSubmitCallback() {
    const { code, wabaId, phoneNumberId } = sessionRef.current;
    if (!code || !wabaId || !phoneNumberId) return; // still waiting on the other event

    try {
      await api.submitWhatsAppConnectCallback({ code, waba_id: wabaId, phone_number_id: phoneNumberId });
      setMessage({ type: 'info', text: 'WhatsApp connected successfully.' });
      await refreshStatus();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      sessionRef.current = {};
      setConnecting(false);
    }
  }

  function handlePrecheckAnswer(value) {
    if (value === 'new') {
      handleConnect();
    } else {
      setPrecheck(value);
    }
  }

  async function handleConnect() {
    setPrecheck(null);
    setMessage(null);
    setConnecting(true);
    sessionRef.current = {};
    try {
      const { appId, configId } = await api.getWhatsAppConnectSession();
      const FB = await loadFacebookSdk(appId);

      FB.login(
        (response) => {
          if (response.authResponse?.code) {
            sessionRef.current.code = response.authResponse.code;
            maybeSubmitCallback();
          } else {
            setConnecting(false); // user closed the popup without completing login
          }
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {} },
        },
      );
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setMessage(null);
    try {
      await api.disconnectWhatsApp();
      setConfirmingDisconnect(false);
      await refreshStatus();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setDisconnecting(false);
    }
  }

  const badgeStyle = {
    not_connected: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    connected: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">WhatsApp Connect</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Connect your own WhatsApp Business number so customer orders and messages send from it directly.
        </p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/20">
            <MessageCircle className="h-5 w-5 text-green-600 dark:text-green-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Connection status</p>
            {loadingStatus ? (
              <p className="text-xs text-gray-500">Loading...</p>
            ) : (
              <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeStyle[status?.status] || badgeStyle.not_connected}`}>
                {status?.status === 'connected' && <CheckCircle2 className="h-3 w-3" />}
                {status?.status === 'error' && <XCircle className="h-3 w-3" />}
                {STATUS_LABEL[status?.status] || 'Not connected'}
              </span>
            )}
          </div>
        </div>

        {status?.status === 'connected' && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Number: <span className="font-mono">{status.phone_number_id_masked}</span>
            {status.connected_at && <> · connected {new Date(status.connected_at).toLocaleDateString()}</>}
          </p>
        )}

        {message && (
          <div className={`rounded-lg px-3 py-2 text-xs ${message.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'}`}>
            {message.text}
          </div>
        )}

        {!isOwner && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Only the restaurant owner can connect or disconnect WhatsApp.</p>
        )}

        {isOwner && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {status?.status !== 'connected' && !precheck && (
              <button onClick={() => { setMessage(null); setPrecheck('ask'); }} disabled={connecting} className="btn-primary text-sm">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                {connecting ? 'Connecting…' : status?.status === 'error' ? 'Retry connection' : 'Connect WhatsApp'}
              </button>
            )}

            {status?.status === 'connected' && !confirmingDisconnect && (
              <button onClick={() => setConfirmingDisconnect(true)} className="btn-secondary text-sm">
                <Unlink className="h-4 w-4" />
                Disconnect
              </button>
            )}
            {confirmingDisconnect && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-600 dark:text-gray-400">Disconnect this number? Messages will stop sending until reconnected.</span>
                <button onClick={handleDisconnect} disabled={disconnecting} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-60">
                  {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes, disconnect'}
                </button>
                <button onClick={() => setConfirmingDisconnect(false)} className="rounded-lg px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                  Cancel
                </button>
              </div>
            )}

            <button onClick={refreshStatus} className="ml-auto flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        )}

        {isOwner && precheck === 'ask' && (
          <div className="space-y-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Do you already use this number on WhatsApp?</p>
            {PRECHECK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handlePrecheckAnswer(opt.value)}
                className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-green-500 hover:bg-green-50 dark:border-gray-700 dark:hover:bg-green-900/10"
              >
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{opt.label}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.hint}</span>
              </button>
            ))}
            <button onClick={() => setPrecheck(null)} className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Cancel
            </button>
          </div>
        )}

        {isOwner && precheck === 'whatsapp_app' && (
          <div className="space-y-3 border-t border-gray-100 pt-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
            <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Meta only lets a number be connected here once it no longer has a WhatsApp account on a phone.
                If you continue without doing this, Meta's signup window will stop with
                “This number is registered to an existing WhatsApp account…”.
              </span>
            </div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Before you connect, on the phone that uses this number:</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              <li><strong>Optional — save your chats:</strong> Settings → Chats → Chat backup, or export important chats. Chat history is not moved over.</li>
              <li><strong>Delete the WhatsApp account:</strong> open WhatsApp (or WhatsApp Business) → Settings → Account → Delete my account, then confirm with this number.</li>
              <li>Keep the SIM active. You'll need it to receive Meta's verification code by SMS or call.</li>
            </ol>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Deleting the account removes chat history, groups and the app profile from that phone. The number itself and your
              customers' saved contacts stay the same, so customers keep messaging the same number.
              After connecting, you'll answer customers from RestoAI instead of the WhatsApp app.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleConnect} disabled={connecting} className="btn-primary text-sm">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                I've deleted it, continue
              </button>
              <button onClick={() => setPrecheck('ask')} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>
            </div>
          </div>
        )}

        {isOwner && precheck === 'other_provider' && (
          <div className="space-y-3 border-t border-gray-100 pt-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">This needs an assisted migration</p>
            <p className="text-xs">
              Numbers already running on another provider (Wati, Gupshup, 360dialog, etc.) can't be connected with the
              Connect button. Meta has to move them from that provider's account to ours. Done this way, you keep
              your approved message templates, quality rating and messaging limits.
            </p>
            <p className="text-xs">
              Email us and we'll plan the switch with you. Please don't cancel your current provider until the move is finished,
              so customer messages keep working.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('WhatsApp number migration')}&body=${encodeURIComponent(`Restaurant account ID: ${user?.tenant_id || ''}\nRestaurant name: \nCurrent provider: \nWhatsApp number: \n`)}`}
                className="btn-primary text-sm"
              >
                <Mail className="h-4 w-4" />
                Contact support
              </a>
              <button onClick={() => setPrecheck('ask')} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{SUPPORT_EMAIL}</p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
        Disconnecting only clears the connection here — it does not remove the number from your Meta Business account.
      </p>
    </div>
  );
}
