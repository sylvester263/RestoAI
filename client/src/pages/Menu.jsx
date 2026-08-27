import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2, Search, ToggleLeft, ToggleRight, Image, X } from 'lucide-react';

export default function Menu() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | item object
  const [form, setForm] = useState({ name: '', name_urdu: '', description: '', price: '', category_id: '', is_available: true, tags: '' });
  const [imgUploading, setImgUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    Promise.all([api.getMenu(), api.getCategories()])
      .then(([menuRes, catRes]) => {
        setItems(menuRes.items);
        setCategories(catRes.categories);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    const payload = {
      ...form,
      price: Number(form.price),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      category_id: form.category_id || undefined,
    };

    try {
      if (editing === 'new') {
        const res = await api.createMenuItem(payload);
        setItems((prev) => [...prev, res.item]);
      } else {
        const res = await api.updateMenuItem(editing.id, payload);
        setItems((prev) => prev.map((i) => (i.id === editing.id ? res.item : i)));
      }
      setEditing(null);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this item?')) return;
    await api.deleteMenuItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function toggleAvailability(item) {
    const res = await api.updateMenuItem(item.id, { is_available: !item.is_available });
    setItems((prev) => prev.map((i) => (i.id === item.id ? res.item : i)));
  }

  function startEdit(item) {
    setEditing(item);
    setForm({
      name: item.name,
      name_urdu: item.name_urdu || '',
      description: item.description || '',
      price: String(item.price),
      category_id: item.category_id || '',
      is_available: item.is_available,
      tags: (item.tags || []).join(', '),
      image_url: item.image_url || null,
    });
  }

  function startNew() {
    setEditing('new');
    setForm({ name: '', name_urdu: '', description: '', price: '', category_id: '', is_available: true, tags: '', image_url: null });
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file || editing === 'new') return;
    setImgUploading(true);
    try {
      const res = await api.uploadMenuItemImage(editing.id, file);
      setItems((prev) => prev.map((i) => (i.id === editing.id ? res.item : i)));
      setForm((f) => ({ ...f, image_url: res.item.image_url }));
    } catch (err) {
      alert(err.message);
    } finally {
      setImgUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleImageRemove() {
    if (editing === 'new' || !form.image_url) return;
    if (!confirm('Remove this photo?')) return;
    try {
      await api.deleteMenuItemImage(editing.id);
      setItems((prev) => prev.map((i) => (i.id === editing.id ? { ...i, image_url: null } : i)));
      setForm((f) => ({ ...f, image_url: null }));
    } catch (err) {
      alert(err.message);
    }
  }

  const filtered = items.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.name_urdu || '').includes(search) ||
    (i.category_name || '').toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) return <div className="flex items-center justify-center py-20">Loading menu...</div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
          <p className="text-sm text-gray-500">{items.length} items</p>
        </div>
        <button onClick={startNew} className="btn-primary">
          <Plus className="h-4 w-4" /> Add Item
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-10"
          placeholder="Search menu items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card w-full max-w-lg">
            <h2 className="mb-4 text-lg font-semibold">{editing === 'new' ? 'Add Menu Item' : 'Edit Menu Item'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Urdu Name</label>
                  <input className="input text-right" dir="rtl" value={form.name_urdu} onChange={(e) => setForm({ ...form, name_urdu: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
                <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Price (PKR)</label>
                  <input className="input" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
                  <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                    <option value="">None</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Tags (comma-separated)</label>
                <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </div>
              {/* Image upload — only for existing items (not new, which aren't saved yet) */}
              {editing !== 'new' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Photo</label>
                  {form.image_url ? (
                    <div className="relative inline-block">
                      <img src={form.image_url} alt="menu item" className="h-24 w-24 rounded-lg object-cover" />
                      <button
                        onClick={handleImageRemove}
                        className="absolute -right-2 -top-2 rounded-full bg-red-500 p-0.5 text-white hover:bg-red-600"
                        title="Remove photo"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={imgUploading}
                      className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600"
                    >
                      <Image className="h-4 w-4" />
                      {imgUploading ? 'Uploading...' : 'Upload photo'}
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                  {editing === 'new' && <p className="mt-1 text-xs text-gray-400">Save the item first, then add a photo.</p>}
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Menu table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-600">Item</th>
              <th className="px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="px-4 py-3 font-medium text-gray-600">Price</th>
              <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                        <Image className="h-4 w-4 text-gray-300" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-900">{item.name}</p>
                      {item.name_urdu && <p className="text-xs text-gray-400" dir="rtl">{item.name_urdu}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{item.category_name || '—'}</td>
                <td className="px-4 py-3 font-medium">Rs. {Number(item.price).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleAvailability(item)} className="flex items-center gap-1">
                    {item.is_available ? (
                      <span className="badge bg-green-100 text-green-700"><ToggleRight className="mr-1 h-3 w-3" /> Available</span>
                    ) : (
                      <span className="badge bg-gray-100 text-gray-500"><ToggleLeft className="mr-1 h-3 w-3" /> Unavailable</span>
                    )}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(item)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No items found</div>
        )}
      </div>
    </div>
  );
}
