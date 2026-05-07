import { useState, useRef } from 'react';
import { api } from '../../api.js';
import PartialDateInput from '../PartialDateInput.jsx';
import { useConfirm } from '../ConfirmModal.jsx';
import { formatPartialDate } from './dates.js';

export default function ReadsSection({ bookId, reads, isFinished, onUpdate, onBookUpdate }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ date_started: '', date_finished: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Tracks read ids whose delete is in flight. The ConfirmModal cancels
  // an overlapping confirm() so a rapid double-click on the same ✕ won't
  // fire two deletes — but a *re-click* after confirming (while the API
  // call is still pending and the row is still visibly listed) can,
  // producing a 404 on the second call and a misleading "Failed to
  // delete read" banner above a row that did delete. Mirrors the shape
  // of Readlist's removingIdsRef.
  const deletingIdsRef = useRef(new Set());
  const confirm = useConfirm();

  // On a finished book, "log a read" means re-read: bump read_count + add row
  // atomically via the backend's /reread endpoint. On an in-progress book it's
  // just an explicit log entry, no count bump (book hasn't been "finished" yet).
  const isReread = !!isFinished;

  function startAdd() {
    setAdding(true);
    setEditId(null);
    setError(null);
    setForm({ date_started: '', date_finished: '' });
  }

  function startEdit(r) {
    setEditId(r.id);
    setAdding(false);
    setError(null);
    setForm({ date_started: r.date_started || '', date_finished: r.date_finished || '' });
  }

  function validateDates() {
    // PartialDateInput only emits well-formed partial dates (YYYY / YYYY-MM /
    // YYYY-MM-DD), so the only check left is ordering. Compare on the shared
    // prefix so mixed-precision pairs (e.g. started '2024-06', finished '2024')
    // don't trip a lexical false-positive.
    if (form.date_started && form.date_finished) {
      const n = Math.min(form.date_started.length, form.date_finished.length);
      if (form.date_finished.slice(0, n) < form.date_started.slice(0, n)) {
        setError('Finish date cannot be before start date');
        return false;
      }
    }
    return true;
  }

  async function handleAdd(e) {
    e.preventDefault();
    // Mirror the disabled button. The re-read path is the load-bearing case:
    // a double-fire would bump read_count by 2 and insert two reads rows.
    if (saving) return;
    if (!validateDates()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { date_started: form.date_started || null, date_finished: form.date_finished || null };
      if (isReread) {
        const updated = await api.rereadBook(bookId, payload);
        onBookUpdate?.(updated);
      } else {
        await api.addRead(bookId, payload);
      }
      setAdding(false);
      setForm({ date_started: '', date_finished: '' });
      onUpdate();
    } catch {
      setError(isReread ? 'Failed to log re-read' : 'Failed to add read');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(e, readId) {
    e.preventDefault();
    if (saving) return;
    if (!validateDates()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateRead(bookId, readId, { date_started: form.date_started || null, date_finished: form.date_finished || null });
      setEditId(null);
      onUpdate();
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(readId) {
    if (deletingIdsRef.current.has(readId)) return;
    if (!await confirm('Remove this read entry?')) return;
    if (deletingIdsRef.current.has(readId)) return;
    deletingIdsRef.current.add(readId);
    setError(null);
    try {
      await api.deleteRead(bookId, readId);
      onUpdate();
    } catch {
      setError('Failed to delete read');
    } finally {
      deletingIdsRef.current.delete(readId);
    }
  }

  return (
    <div className="border-t border-neutral-800 pt-5 mb-6">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Read history</p>
      {reads.length > 0 ? (
        <div className="space-y-2 mb-3">
          {reads.map((r, i) => editId === r.id ? (
            <form key={r.id} onSubmit={(e) => handleUpdate(e, r.id)} className="flex flex-wrap items-center gap-2">
              <PartialDateInput size="sm" value={form.date_started}  onChange={v => setForm(f => ({ ...f, date_started: v }))}  />
              <span className="text-neutral-600 text-xs">→</span>
              <PartialDateInput size="sm" value={form.date_finished} onChange={v => setForm(f => ({ ...f, date_finished: v }))} />
              <button type="submit" disabled={saving} className="text-xs text-oak hover:text-oak/80 transition-colors disabled:opacity-40">Save</button>
              <button type="button" onClick={() => setEditId(null)} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">Cancel</button>
            </form>
          ) : (
            <div key={r.id} className="flex items-center gap-3 group">
              <span className="text-xs text-neutral-600 w-4 text-right flex-shrink-0">{i + 1}.</span>
              <span className="text-xs text-neutral-400 flex-1">
                {r.date_started ? formatPartialDate(r.date_started) : '—'}
                {r.date_finished ? <> <span className="text-neutral-600">→</span> {formatPartialDate(r.date_finished)}</> : ''}
              </span>
              <button onClick={() => startEdit(r)} className="text-xs text-neutral-700 hover:text-neutral-400 opacity-30 group-hover:opacity-100 transition-all">Edit</button>
              <button onClick={() => handleDelete(r.id)} className="text-xs text-neutral-700 hover:text-warn opacity-30 group-hover:opacity-100 transition-all ml-1">×</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-600 mb-3">No reads logged yet.</p>
      )}
      {adding ? (
        <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
          <PartialDateInput size="sm" value={form.date_started}  onChange={v => setForm(f => ({ ...f, date_started: v }))}  />
          <span className="text-neutral-600 text-xs">→</span>
          <PartialDateInput size="sm" value={form.date_finished} onChange={v => setForm(f => ({ ...f, date_finished: v }))} />
          <button type="submit" disabled={saving} className="text-xs text-oak hover:text-oak/80 transition-colors disabled:opacity-40">Add</button>
          <button type="button" onClick={() => { setAdding(false); setError(null); }} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">Cancel</button>
        </form>
      ) : (
        <button onClick={startAdd} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
          {isReread ? '+ Log a re-read' : '+ Log a read'}
        </button>
      )}
      {error && <p className="text-xs text-warn mt-2">{error}</p>}
    </div>
  );
}
