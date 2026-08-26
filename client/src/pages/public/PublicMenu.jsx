import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { publicApi } from '../../lib/api';
import { getCart, addToCart, updateCartQuantity } from '../../lib/publicOrderStore';
import { ShoppingCart, Plus, Minus, CalendarCheck, Star, Gift } from 'lucide-react';
import AIAssistantWidget from './AIAssistantWidget';

export default function PublicMenu() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState([]);
  const [ratings, setRatings] = useState({});

  useEffect(() => {
    setCart(getCart(tenantSlug));
    Promise.all([publicApi.getRestaurant(tenantSlug), publicApi.getMenu(tenantSlug)])
      .then(([r, m]) => {
        setRestaurant(r.restaurant);
        setItems(m.items);
        Promise.all(
          m.items.map((item) =>
            publicApi.getItemReviews(tenantSlug, item.id)
              .then((res) => [item.id, res])
              .catch(() => [item.id, null]),
          ),
        ).then((pairs) => {
          const map = {};
          for (const [id, res] of pairs) if (res && res.count > 0) map[id] = res;
          setRatings(map);
        });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  function quantityOf(itemId) {
    return cart.find((i) => i.menu_item_id === itemId)?.quantity || 0;
  }

  function handleAdd(item) {
    const updated = addToCart(tenantSlug, {
      menu_item_id: item.id,
      name: item.name,
      price: Number(item.price),
      quantity: 1,
    });
    setCart(updated);
  }

  function handleQuantityChange(item, delta) {
    const updated = updateCartQuantity(tenantSlug, item.id, quantityOf(item.id) + delta);
    setCart(updated);
  }

  if (loading) return <div className="flex items-center justify-center py-20">Loading menu...</div>;
  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <p className="text-gray-500">This restaurant couldn't be found.</p>
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

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="border-b border-gray-200 bg-white px-4 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{restaurant?.name}</h1>
            {restaurant?.address && <p className="text-sm text-gray-500">{restaurant.address}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => navigate(`/order/${tenantSlug}/loyalty`)} className="btn-secondary text-sm">
              <Gift className="h-4 w-4" /> Points
            </button>
            <button onClick={() => navigate(`/order/${tenantSlug}/reserve`)} className="btn-secondary text-sm">
              <CalendarCheck className="h-4 w-4" /> Book a Table
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
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
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-sm font-semibold text-brand-600">
                          Rs. {Number(item.price).toLocaleString()}
                        </p>
                        {ratings[item.id] && (
                          <span className="flex items-center gap-0.5 text-xs text-gray-500">
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            {ratings[item.id].average} ({ratings[item.id].count})
                          </span>
                        )}
                      </div>
                    </div>
                    {qty === 0 ? (
                      <button onClick={() => handleAdd(item)} className="btn-primary shrink-0">
                        <Plus className="h-4 w-4" /> Add
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-3">
                        <button
                          onClick={() => handleQuantityChange(item, -1)}
                          className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-6 text-center font-medium">{qty}</span>
                        <button
                          onClick={() => handleQuantityChange(item, 1)}
                          className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
                        >
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
        {items.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No menu items available right now</div>
        )}
      </div>

      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-4">
          <button
            onClick={() => navigate(`/order/${tenantSlug}/checkout`)}
            className="btn-primary mx-auto flex w-full max-w-2xl items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" /> {cartCount} item{cartCount > 1 ? 's' : ''}
            </span>
            <span>Rs. {cartTotal.toLocaleString()} · Checkout</span>
          </button>
        </div>
      )}

      <AIAssistantWidget tenantSlug={tenantSlug} />
    </div>
  );
}
