import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { tableApi } from '../../lib/api';
import { getCart, addToCart, updateCartQuantity, clearCart } from '../../lib/publicOrderStore';
import { Plus, Minus, Receipt, Users } from 'lucide-react';

export default function TableOrder() {
  const { qrToken } = useParams();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [session, setSession] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [items, setItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [view, setView] = useState('menu'); // 'menu' | 'bill'
  const [bill, setBill] = useState(null);
  const [splitCount, setSplitCount] = useState(1);
  const [placing, setPlacing] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  useEffect(() => {
    tableApi.getSession(qrToken)
      .then((res) => {
        setSession(res.session);
        setRestaurant(res.restaurant);
        setItems(res.menu);
        setCart(getCart(res.session.id));
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [qrToken]);

  function quantityOf(itemId) {
    return cart.find((i) => i.menu_item_id === itemId)?.quantity || 0;
  }

  function handleAdd(item) {
    setCart(addToCart(session.id, { menu_item_id: item.id, name: item.name, price: Number(item.price), quantity: 1 }));
  }

  function handleQuantityChange(item, delta) {
    setCart(updateCartQuantity(session.id, item.id, quantityOf(item.id) + delta));
  }

  async function handlePlaceRound() {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      await tableApi.placeOrder(session.id, {
        items: cart.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })),
      });
      clearCart(session.id);
      setCart([]);
      setConfirmation(true);
      setTimeout(() => setConfirmation(false), 3000);
    } catch (err) {
      alert(err.message);
    } finally {
      setPlacing(false);
    }
  }

  async function loadBill() {
    setView('bill');
    try {
      const res = await tableApi.getBill(session.id);
      setBill(res);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRequestBill() {
    try {
      const res = await tableApi.requestBill(session.id);
      setSession(res.session);
      loadBill();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20">Loading table...</div>;
  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <p className="text-gray-500">This table QR code isn't recognized.</p>
      </div>
    );
  }

  const grouped = items.reduce((acc, item) => {
    const category = item.category_name || 'Menu';
    (acc[category] = acc[category] || []).push(item);
    return acc;
  }, {});
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const sessionEnded = session.status !== 'open';

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="border-b border-gray-200 bg-white px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900">{restaurant?.name}</h1>
        <p className="text-sm text-gray-500">Table {session.table_number}</p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => setView('menu')} className={view === 'menu' ? 'btn-primary' : 'btn-secondary'}>Menu</button>
          <button onClick={loadBill} className={view === 'bill' ? 'btn-primary' : 'btn-secondary'}>
            <Receipt className="h-4 w-4" /> Bill
          </button>
        </div>
      </div>

      {confirmation && (
        <div className="mx-auto mt-4 max-w-2xl px-4">
          <div className="rounded-lg bg-green-50 p-3 text-center text-sm font-medium text-green-700">
            Order sent to the kitchen!
          </div>
        </div>
      )}

      {view === 'menu' && (
        <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
          {sessionEnded && (
            <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-700">
              {session.status === 'bill_requested' ? 'Bill requested — ask staff for a new round if you\'d like to order more.' : 'This table session has ended.'}
            </div>
          )}
          {Object.entries(grouped).map(([category, catItems]) => (
            <div key={category}>
              <h2 className="mb-3 text-lg font-semibold text-gray-900">{category}</h2>
              <div className="space-y-3">
                {catItems.map((item) => {
                  const qty = quantityOf(item.id);
                  return (
                    <div key={item.id} className="card flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        {item.description && <p className="text-sm text-gray-500">{item.description}</p>}
                        <p className="mt-1 text-sm font-semibold text-brand-600">Rs. {Number(item.price).toLocaleString()}</p>
                      </div>
                      {sessionEnded ? null : qty === 0 ? (
                        <button onClick={() => handleAdd(item)} className="btn-primary shrink-0">
                          <Plus className="h-4 w-4" /> Add
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-3">
                          <button onClick={() => handleQuantityChange(item, -1)} className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50">
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-6 text-center font-medium">{qty}</span>
                          <button onClick={() => handleQuantityChange(item, 1)} className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50">
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'bill' && bill && (
        <div className="mx-auto max-w-2xl px-4 py-6">
          <div className="card mb-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-600">Itemized bill</h2>
            {bill.rounds.length === 0 ? (
              <p className="text-sm text-gray-400">No orders placed yet.</p>
            ) : (
              bill.rounds.map((round) => (
                <div key={round.id} className="mb-3 border-b border-gray-100 pb-3 last:border-0">
                  <p className="mb-1 text-xs font-medium text-gray-400">Round · Rs. {Number(round.total).toLocaleString()}</p>
                  {round.items.map((i, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span>{i.quantity}x {i.name}</span>
                      <span>Rs. {Number(i.total_price).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
            <div className="flex justify-between border-t border-gray-200 pt-3 text-base font-semibold text-gray-900">
              <span>Grand Total</span>
              <span>Rs. {bill.grand_total.toLocaleString()}</span>
            </div>
          </div>

          <div className="card mb-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-600"><Users className="h-4 w-4" /> Split evenly</h2>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                className="input w-24"
                value={splitCount}
                onChange={(e) => setSplitCount(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <span className="text-sm text-gray-500">people</span>
              <span className="ml-auto font-semibold text-gray-900">Rs. {Math.ceil(bill.grand_total / splitCount).toLocaleString()} each</span>
            </div>
          </div>

          {session.status === 'open' && (
            <button onClick={handleRequestBill} className="btn-primary w-full justify-center">Request Bill from Staff</button>
          )}
          {session.status === 'bill_requested' && (
            <p className="text-center text-sm text-gray-500">Bill requested — staff will come to settle up.</p>
          )}
        </div>
      )}

      {view === 'menu' && cartCount > 0 && !sessionEnded && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-4">
          <button
            onClick={handlePlaceRound}
            disabled={placing}
            className="btn-primary mx-auto flex w-full max-w-2xl items-center justify-between"
          >
            <span>{cartCount} item{cartCount > 1 ? 's' : ''}</span>
            <span>{placing ? 'Sending...' : `Rs. ${cartTotal.toLocaleString()} · Send to Kitchen`}</span>
          </button>
        </div>
      )}
    </div>
  );
}
