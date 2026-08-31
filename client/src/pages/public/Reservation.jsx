import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicApi } from '../../lib/api';
import { toast } from '../../components/ui/toast';
import { ArrowLeft, CalendarCheck } from 'lucide-react';

export default function Reservation() {
  const { tenantSlug } = useParams();
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', party_size: 2, date: '', time: '', notes: '' });

  useEffect(() => {
    publicApi.getRestaurant(tenantSlug)
      .then((res) => setRestaurant(res.restaurant))
      .catch(() => setRestaurant(null))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const reservedFor = new Date(`${form.date}T${form.time}:00+05:00`).toISOString();
      const res = await publicApi.createReservation(tenantSlug, {
        customer_name: form.name,
        customer_phone: form.phone,
        party_size: Number(form.party_size),
        reserved_for: reservedFor,
        notes: form.notes || undefined,
      });
      setConfirmed(res.reservation);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20">Loading...</div>;

  if (confirmed) {
    const when = new Date(confirmed.reserved_for).toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short',
    });
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <CalendarCheck className="h-10 w-10 text-brand-600" />
        <h1 className="text-xl font-bold text-gray-900">Table booked!</h1>
        <p className="text-gray-600">{form.party_size} people · {when}</p>
        <p className="text-sm text-gray-400">A WhatsApp confirmation has been sent to {form.phone}</p>
        <Link to={`/order/${tenantSlug}`} className="mt-4 text-sm text-brand-600 hover:underline">Back to menu</Link>
      </div>
    );
  }

  // Karachi calendar date, not the browser's UTC date — avoids the date
  // picker's min bound rolling back a day once it's past midnight in Pakistan.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <Link to={`/order/${tenantSlug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Back to menu
        </Link>
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Book a Table</h1>
        <p className="mb-4 text-sm text-gray-500">{restaurant?.name}</p>

        <form onSubmit={handleSubmit} className="card space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Your name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Phone number</label>
            <input className="input" required placeholder="+92300..." value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Party size</label>
              <input type="number" min="1" className="input" required value={form.party_size} onChange={(e) => setForm({ ...form, party_size: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date</label>
              <input type="date" min={today} className="input" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Time</label>
            <input type="time" className="input" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Notes (optional)</label>
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center">
            {submitting ? 'Booking...' : 'Book Table'}
          </button>
        </form>
      </div>
    </div>
  );
}
