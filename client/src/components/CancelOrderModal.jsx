/**
 * CancelOrderModal — the one way staff cancel an order (Orders page, Kitchen
 * Display). Requires a reason because the customer receives it verbatim in
 * their cancellation message; the server rejects a cancel without one.
 */
import { useState } from 'react';
import Modal from './ui/Modal';
import { api } from '../lib/api';
import { toast } from './ui/toast';

const QUICK_REASONS = [
  'We\'ve run out of an item in this order',
  'Kitchen is closed for the day',
  'We couldn\'t reach you to confirm',
  'Outside our delivery area',
];

export default function CancelOrderModal({ order, onClose, onCancelled }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!order) return null;

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error('Please give a reason — the customer will see it.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateOrderStatus(order.id, 'cancelled', { reason: trimmed });
      toast.success(`Order #${order.order_number} cancelled — customer notified`);
      onCancelled?.(res.order);
      onClose();
    } catch (err) {
      toast.error(`Couldn't cancel order #${order.order_number}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={`Cancel order #${order.order_number}?`}
      size="md"
      confirmLabel="Cancel order"
      cancelLabel="Keep order"
      onConfirm={handleConfirm}
      variant="danger"
      loading={saving}
    >
      <p className="mb-3 text-sm text-gray-600">
        {order.customer_name ? `${order.customer_name} will` : 'The customer will'} get a message with this reason. This cannot be undone.
      </p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full border px-2.5 py-1 text-xs ${reason === r ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        className="input w-full"
        rows={2}
        maxLength={200}
        placeholder="Reason the customer will see"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}
