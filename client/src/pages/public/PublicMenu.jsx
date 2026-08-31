import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { publicApi } from '../../lib/api';
import { getCart, addToCart, updateCartQuantity } from '../../lib/publicOrderStore';
import { ShoppingCart, Plus, Minus, CalendarCheck, Star, Gift } from 'lucide-react';
import AIAssistantWidget from './AIAssistantWidget';

// Distinct muted colors for category placeholders when a photo isn't set yet.
// Cycles by index so every category gets a consistent tint.
const PLACEHOLDER_COLORS = [
  'bg-orange-100 text-orange-400',
  'bg-emerald-100 text-emerald-400',
  'bg-sky-100 text-sky-400',
  'bg-purple-100 text-purple-400',
  'bg-rose-100 text-rose-400',
  'bg-amber-100 text-amber-400',
];

function categoryColor(categoryName, allCategories) {
  const idx = allCategories.indexOf(categoryName);
  return PLACEHOLDER_COLORS[(idx >= 0 ? idx : 0) % PLACEHOLDER_COLORS.length];
}

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
      image_url: item.image_url || null,
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
        <p className="text-[var(--text-secondary)]">This restaurant couldn't be found.</p>
      </div>
    );
  }

  const grouped = items.reduce((acc, item) => {
    const category = item.category_name || 'Menu';
    (acc[category] = acc[category] || []).push(item);
    return acc;
  }, {});

  const allCategories = Object.keys(grouped);

  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <div className="min-h-screen bg-[var(--surface-1)] pb-28">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">{restaurant?.name}</h1>
            {restaurant?.address && <p className="text-sm text-[var(--text-secondary)]">{restaurant.address}</p>}
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
            <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">{category}</h2>
            <div className="space-y-3">
              {catItems.map((item) => {
                const qty = quantityOf(item.id);
                return (
                  <div key={item.id} className="card flex items-start gap-4">
                    {/* Item photo or category-colored placeholder */}
                    <div className="relative shrink-0">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-20 w-20 rounded-xl object-cover"
                        />
                      ) : (
                        <div className={`flex h-20 w-20 items-center justify-center rounded-xl text-3xl ${categoryColor(item.category_name || 'Menu', allCategories)}`}>
                          🍽️
                        </div>
                      )}
                      {!item.is_available && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
                          <span className="text-xs font-bold uppercase tracking-wide text-white">Sold out</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className={`font-medium text-[var(--text-primary)] ${!item.is_available ? 'line-through text-[var(--text-tertiary)]' : ''}`}>{item.name}</p>
                        {item.description && <p className="text-sm text-[var(--text-secondary)]">{item.description}</p>}
                        <div className="mt-1 flex items-center gap-2">
                          <p className={`text-sm font-semibold ${item.is_available ? 'text-brand-600' : 'text-[var(--text-tertiary)]'}`}>
                            Rs. {Number(item.price).toLocaleString()}
                          </p>
                          {ratings[item.id] && (
                            <span className="flex items-center gap-0.5 text-xs text-[var(--text-secondary)]">
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                              {ratings[item.id].average} ({ratings[item.id].count})
                            </span>
                          )}
                        </div>
                      </div>
                      {item.is_available && (
                        qty === 0 ? (
                          <button onClick={() => handleAdd(item)} className="btn-primary shrink-0">
                            <Plus className="h-4 w-4" /> Add
                          </button>
                        ) : (
                          <div className="flex shrink-0 items-center gap-3">
                            <button
                              onClick={() => handleQuantityChange(item, -1)}
                              className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-6 text-center font-medium">{qty}</span>
                            <button
                              onClick={() => handleQuantityChange(item, 1)}
                              className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--text-tertiary)]">No menu items available right now</div>
        )}
      </div>

      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--surface-2)] p-4">
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
