/**
 * toast utility — wraps react-hot-toast and adds a non-blocking confirm dialog.
 *
 * Usage:
 *   import { toast, confirmAction } from '../components/ui/toast';
 *
 *   toast.success('Item saved');
 *   toast.error('Something went wrong');
 *
 *   const ok = await confirmAction('Delete this item?', 'This cannot be undone.');
 *   if (!ok) return;
 */
import toast from 'react-hot-toast';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import ConfirmDialog from './ConfirmDialog';

/**
 * Non-blocking confirm dialog. Returns a Promise<boolean>.
 * Replaces window.confirm() throughout the app.
 */
function confirmAction(message, detail) {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    container.id = 'confirm-dialog-root';
    document.body.appendChild(container);

    const root = createRoot(container);

    function cleanup(result) {
      root.unmount();
      container.remove();
      resolve(result);
    }

    root.render(
      createElement(ConfirmDialog, {
        message,
        detail,
        onConfirm: () => cleanup(true),
        onCancel: () => cleanup(false),
      }),
    );
  });
}

export { toast, confirmAction };
