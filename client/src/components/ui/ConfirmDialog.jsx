/**
 * ConfirmDialog — non-blocking replacement for window.confirm().
 * Rendered imperatively via the confirmAction() helper in toast.js.
 */
import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ message, detail, onConfirm, onCancel }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={message}
    >
      <div className="w-80 rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium text-gray-900">{message}</p>
            {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button ref={confirmRef} onClick={onConfirm} className="btn-danger">Confirm</button>
        </div>
      </div>
    </div>
  );
}
