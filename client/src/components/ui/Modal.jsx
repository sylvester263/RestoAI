/**
 * Modal — accessible dialog with focus trap, ARIA attributes, scroll lock,
 * and Escape-to-close. Replaces all hand-rolled `fixed inset-0 z-50` overlays.
 *
 * Usage:
 *   <Modal open={show} onClose={handleClose} title="Edit Item">
 *     <p>Content here…</p>
 *   </Modal>
 *
 *   <Modal open={show} onClose={handleClose} title="Confirm" size="sm" confirmLabel="Delete" onConfirm={handleDelete} variant="danger">
 *     <p>Are you sure?</p>
 *   </Modal>
 */
import { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

const SIZES = {
  sm: 'w-80',
  md: 'w-96',
  lg: 'w-[32rem]',
  xl: 'w-[40rem]',
};

export default function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  confirmLabel,
  onConfirm,
  cancelLabel = 'Cancel',
  variant = 'primary', // 'primary' | 'danger'
  loading = false,
  hideCloseButton = false,
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Focus trap + scroll lock
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // Trap focus within the dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    // Focus the first focusable element (or the dialog itself)
    requestAnimationFrame(() => {
      if (dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        (focusable[0] || dialogRef.current).focus();
      }
    });

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const confirmBtnClass =
    variant === 'danger'
      ? 'btn-danger'
      : 'btn-primary';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${SIZES[size] || SIZES.md} max-h-[85vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl`}
      >
        {/* Header */}
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        {children}

        {/* Footer with confirm/cancel */}
        {onConfirm && (
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary" disabled={loading}>
              {cancelLabel}
            </button>
            <button onClick={onConfirm} className={confirmBtnClass} disabled={loading}>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Please wait…
                </span>
              ) : confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
