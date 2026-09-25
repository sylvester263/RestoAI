/**
 * MenuImportModal — "Import from a menu photo": the owner picks a photo of
 * their printed menu, the AI reads it (POST /api/menu/digitize), and they
 * review/edit the extracted items before any are added. Nothing is saved
 * until they press "Add items"; each kept row goes through the normal
 * POST /api/menu, so the usual validation applies.
 */
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { toast } from './ui/toast';
import Modal from './ui/Modal';
import { Camera, Loader2, Trash2 } from 'lucide-react';

const MAX_EDGE = 1600; // px — plenty for the model to read, small enough to upload

// Downscale in the browser so a 5-10 MB phone photo becomes a few hundred KB.
function readAsJpegBase64(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be opened as an image."));
    };
    img.src = url;
  });
}

function matchCategory(name, categories) {
  if (!name) return '';
  const n = name.trim().toLowerCase();
  const hit = categories.find((c) => c.name.toLowerCase() === n)
    || categories.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
  return hit ? hit.id : '';
}

export default function MenuImportModal({ open, onClose, categories, existingNames, onImported }) {
  const fileRef = useRef(null);
  const [stage, setStage] = useState('pick'); // pick | reading | review | saving
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);

  function reset() {
    setStage('pick');
    setError('');
    setRows([]);
  }

  function close() {
    if (stage === 'reading' || stage === 'saving') return;
    reset();
    onClose();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setStage('reading');
    try {
      const base64 = await readAsJpegBase64(file);
      const res = await api.digitizeMenu(base64, 'image/jpeg');
      const existing = new Set(existingNames.map((n) => n.toLowerCase()));
      setRows(res.extracted_items.map((it, i) => ({
        key: i,
        keep: !existing.has(it.name.toLowerCase()),
        duplicate: existing.has(it.name.toLowerCase()),
        name: it.name,
        name_urdu: it.name_urdu || '',
        description: it.description || '',
        price: it.price != null ? String(it.price) : '',
        category_id: matchCategory(it.category, categories),
        category_read: it.category || '',
      })));
      setStage('review');
    } catch (err) {
      setError(err.message);
      setStage('pick');
    }
  }

  function update(key, field, value) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  const kept = rows.filter((r) => r.keep);
  const invalid = kept.filter((r) => !r.name.trim() || !(parseFloat(r.price) > 0));

  async function handleSave() {
    if (kept.length === 0 || invalid.length > 0) return;
    setStage('saving');
    const created = [];
    const failed = [];
    for (const r of kept) {
      try {
        const res = await api.createMenuItem({
          name: r.name.trim(),
          name_urdu: r.name_urdu.trim() || undefined,
          description: r.description.trim() || undefined,
          price: parseFloat(r.price),
          category_id: r.category_id || undefined,
          is_available: true,
          tags: [],
        });
        created.push(res.item);
      } catch (err) {
        failed.push(`${r.name}: ${err.message}`);
      }
    }
    if (created.length) {
      onImported(created);
      toast.success(`Added ${created.length} item${created.length > 1 ? 's' : ''} to the menu`);
    }
    if (failed.length) {
      // Keep only the rows that didn't save, so the owner can fix and retry
      const savedNames = new Set(created.map((c) => c.name));
      setRows((rs) => rs.filter((r) => !(r.keep && savedNames.has(r.name.trim()))));
      setError(`${failed.length} item${failed.length > 1 ? 's' : ''} couldn't be added — ${failed.join('; ')}`);
      setStage('review');
      return;
    }
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Import from a menu photo" size="xl" hideCloseButton={stage === 'reading' || stage === 'saving'}>
      {stage === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Take or upload a clear photo of your printed menu. The AI reads the dish names, prices and sections,
            then you check everything before it's added.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-8 text-sm text-[var(--text-secondary)] hover:border-brand-400 hover:text-brand-600"
          >
            <Camera className="h-8 w-8" />
            Choose a menu photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {stage === 'reading' && (
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          Reading your menu… this can take up to half a minute.
        </div>
      )}

      {(stage === 'review' || stage === 'saving') && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Found {rows.length} item{rows.length === 1 ? '' : 's'}. Check names and prices, untick anything you don't want, then add them.
          </p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.key} className={`rounded-lg border border-[var(--border)] p-2 ${r.keep ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.keep}
                    onChange={(e) => update(r.key, 'keep', e.target.checked)}
                    aria-label={`Include ${r.name}`}
                  />
                  <input className="input min-w-0 flex-1" value={r.name} onChange={(e) => update(r.key, 'name', e.target.value)} aria-label="Name" />
                  <input
                    className={`input w-24 ${r.keep && !(parseFloat(r.price) > 0) ? 'border-red-400' : ''}`}
                    inputMode="decimal"
                    placeholder="Price"
                    value={r.price}
                    onChange={(e) => update(r.key, 'price', e.target.value)}
                    aria-label="Price"
                  />
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="p-1 text-[var(--text-tertiary)] hover:text-red-600" title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                  <select className="input w-auto" value={r.category_id} onChange={(e) => update(r.key, 'category_id', e.target.value)} aria-label="Category">
                    <option value="">No category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {r.category_read && !r.category_id && (
                    <span className="text-xs text-[var(--text-tertiary)]">Menu section "{r.category_read}" isn't one of your categories</span>
                  )}
                  {r.duplicate && <span className="text-xs text-amber-600">Already on your menu</span>}
                </div>
                {r.description && <p className="mt-1 pl-6 text-xs text-[var(--text-tertiary)]">{r.description}</p>}
              </div>
            ))}
          </div>
          {invalid.length > 0 && <p className="text-xs text-red-600">Every ticked item needs a name and a price above 0.</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={reset} className="btn-secondary" disabled={stage === 'saving'}>Try another photo</button>
            <button type="button" onClick={handleSave} className="btn-primary" disabled={stage === 'saving' || kept.length === 0 || invalid.length > 0}>
              {stage === 'saving' ? 'Adding…' : `Add ${kept.length} item${kept.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
