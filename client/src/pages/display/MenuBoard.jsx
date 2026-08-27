import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { displayApi } from '../../lib/api';

export default function MenuBoard() {
  const { branchId } = useParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await displayApi.getMenuBoard(branchId);
        setItems(res.items);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 45000);
    return () => clearInterval(interval);
  }, [branchId]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-gray-950 text-3xl text-gray-500">Loading menu...</div>;

  const grouped = items.reduce((acc, item) => {
    const category = item.category_name || 'Menu';
    (acc[category] = acc[category] || []).push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-950 p-10 text-white">
      <div className="mx-auto max-w-5xl columns-1 gap-10 md:columns-2">
        {Object.entries(grouped).map(([category, catItems]) => (
          <div key={category} className="mb-10 break-inside-avoid">
            <h2 className="mb-4 border-b-2 border-brand-500 pb-2 text-3xl font-bold text-brand-500">{category}</h2>
            <div className="space-y-3">
              {catItems.map((item) => (
                <div key={item.id} className={`flex items-center gap-4 ${!item.is_available ? 'opacity-40' : ''}`}>
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="flex flex-1 items-baseline justify-between gap-4">
                    <div>
                      <span className="text-xl font-medium">{item.name}</span>
                      {item.name_urdu && <span className="ml-2 text-lg text-gray-400" dir="rtl">{item.name_urdu}</span>}
                      {!item.is_available && <span className="ml-2 text-sm uppercase tracking-wide text-red-400">Sold Out</span>}
                    </div>
                    <span className="whitespace-nowrap text-xl font-semibold text-brand-500">Rs. {Number(item.price).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
