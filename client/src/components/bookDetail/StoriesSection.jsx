import { useState, useRef } from 'react';
import { api } from '../../api.js';
import PartialDateInput from '../PartialDateInput.jsx';
import StarRating from '../StarRating.jsx';
import { useConfirm } from '../ConfirmModal.jsx';
import { formatPartialDate } from './dates.js';

// Per-story table of contents for a collection. Each story belongs to a
// parent book and tracks its own status / rating / date_finished / DNF,
// page range, optional per-story author override (anthologies, adaptations
// like Junji Ito's versions of Edogawa Ranpo / Robert Hichens stories),
// and year of first publication. Finishing the last accounted story
// auto-rolls the parent book to 'finished'.
//
// Visible only when the parent book has the Stories or Anthology tag, or
// when at least one story is already attached (so a user can populate
// then hide if they retag, without losing the data).
const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', finished: 'Finished' };

function pageRangeText(s) {
  if (s.page_start == null && s.page_end == null) return null;
  if (s.page_start != null && s.page_end != null && s.page_end > s.page_start) {
    return `p. ${s.page_start}–${s.page_end}`;
  }
  return `p. ${s.page_start ?? s.page_end}`;
}

function authorText(s, fallbackAuthors) {
  const list = s.authors?.length ? s.authors : fallbackAuthors;
  if (!list?.length) return null;
  return list.map(a => a.name).join(', ');
}

function emptyForm() {
  return {
    title: '',
    position: '',
    status: 'unread',
    date_finished: '',
    rating: null,
    did_not_finish: false,
    notes: '',
    page_start: '',
    page_end: '',
    year_published: '',
    authorsText: '',
  };
}

function toForm(s) {
  return {
    title: s.title || '',
    position: s.position != null ? String(s.position) : '',
    status: s.status || 'unread',
    date_finished: s.date_finished || '',
    rating: s.rating ?? null,
    did_not_finish: !!s.did_not_finish,
    notes: s.notes || '',
    page_start: s.page_start != null ? String(s.page_start) : '',
    page_end:   s.page_end   != null ? String(s.page_end)   : '',
    year_published: s.year_published != null ? String(s.year_published) : '',
    // Authors live in a comma-separated text input on the form; the
    // canonical structure (authors[]) only emerges on save. Empty string
    // means "use parent book's authors as fallback" — matches the
    // backend's empty-array semantics.
    authorsText: (s.authors || []).map(a => a.name).join(', '),
  };
}

function toPayload(form) {
  const authors = form.authorsText
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return {
    title: form.title.trim(),
    position: form.position === '' ? null : Number(form.position),
    status: form.status,
    date_finished: form.date_finished || null,
    rating: form.rating,
    did_not_finish: form.did_not_finish,
    notes: form.notes.trim() || null,
    page_start: form.page_start === '' ? null : Number(form.page_start),
    page_end:   form.page_end   === '' ? null : Number(form.page_end),
    year_published: form.year_published === '' ? null : Number(form.year_published),
    authors,
  };
}

export default function StoriesSection({ bookId, stories, bookAuthors = [], onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Mirrors ReadsSection.savingRef — same-tick double-submit would otherwise
  // create two stories before saving (state) commits.
  const savingRef = useRef(false);
  const deletingIdsRef = useRef(new Set());
  const confirm = useConfirm();

  function startAdd() {
    setAdding(true);
    setEditId(null);
    setError(null);
    // Pre-fill position to the next slot so a user adding contents from a
    // table-of-contents in order doesn't have to type 1, 2, 3, ...
    const nextPos = stories.reduce((m, s) => Math.max(m, s.position ?? 0), 0) + 1;
    setForm({ ...emptyForm(), position: String(nextPos) });
  }

  function startEdit(s) {
    setEditId(s.id);
    setAdding(false);
    setError(null);
    setForm(toForm(s));
  }

  function cancel() {
    setAdding(false);
    setEditId(null);
    setError(null);
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (savingRef.current || saving) return;
    if (!form.title.trim()) { setError('Title is required'); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.addStory(bookId, toPayload(form));
      cancel();
      onUpdate();
    } catch {
      setError('Failed to add story');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleUpdate(e, storyId) {
    e.preventDefault();
    if (savingRef.current || saving) return;
    if (!form.title.trim()) { setError('Title is required'); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.updateStory(bookId, storyId, toPayload(form));
      cancel();
      onUpdate();
    } catch {
      setError('Failed to save');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleDelete(storyId, title) {
    if (deletingIdsRef.current.has(storyId)) return;
    if (!await confirm(`Remove "${title}" from contents?`)) return;
    if (deletingIdsRef.current.has(storyId)) return;
    deletingIdsRef.current.add(storyId);
    setError(null);
    try {
      await api.deleteStory(bookId, storyId);
      onUpdate();
    } catch {
      setError('Failed to delete story');
    } finally {
      deletingIdsRef.current.delete(storyId);
    }
  }

  // Quick-toggle finished: clicking the status pill cycles unread → reading
  // → finished (and back). Bypasses the edit form for the common case.
  async function cycleStatus(s) {
    const next = s.status === 'unread' ? 'reading' : s.status === 'reading' ? 'finished' : 'unread';
    try {
      await api.updateStory(bookId, s.id, {
        ...toPayload(toForm(s)),
        status: next,
        date_finished: next === 'finished' && !s.date_finished ? new Date().toLocaleDateString('en-CA') : s.date_finished,
      });
      onUpdate();
    } catch {
      setError('Failed to update status');
    }
  }

  const formBody = (
    <>
      <input
        type="text"
        autoFocus
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        placeholder="Story title"
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 flex-1 min-w-[12rem]"
      />
      <input
        type="number"
        value={form.position}
        onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
        placeholder="#"
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-oak/50 w-14"
      />
      <input
        type="number"
        value={form.page_start}
        onChange={e => setForm(f => ({ ...f, page_start: e.target.value }))}
        placeholder="p."
        title="Starting page"
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-oak/50 w-16"
      />
      <input
        type="number"
        value={form.page_end}
        onChange={e => setForm(f => ({ ...f, page_end: e.target.value }))}
        placeholder="end"
        title="Ending page (optional)"
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-oak/50 w-16"
      />
      <input
        type="number"
        value={form.year_published}
        onChange={e => setForm(f => ({ ...f, year_published: e.target.value }))}
        placeholder="year"
        title="First publication year (optional). Powers the cross-collection chronological view."
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-oak/50 w-16"
      />
      <input
        type="text"
        value={form.authorsText}
        onChange={e => setForm(f => ({ ...f, authorsText: e.target.value }))}
        placeholder="Authors (override)"
        title="Comma-separated. Empty = use the book's authors."
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-oak/50 flex-1 min-w-[10rem]"
      />
      <select
        value={form.status}
        onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
        className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-oak/50"
      >
        <option value="unread">Unread</option>
        <option value="reading">Reading</option>
        <option value="finished">Finished</option>
      </select>
      {form.status === 'finished' && (
        <PartialDateInput size="sm" value={form.date_finished} onChange={v => setForm(f => ({ ...f, date_finished: v }))} />
      )}
      <StarRating
        value={form.rating}
        onChange={v => setForm(f => ({ ...f, rating: v }))}
        size="text-sm"
      />
      <label className="flex items-center gap-1 text-xs text-neutral-500 select-none cursor-pointer">
        <input type="checkbox" checked={form.did_not_finish} onChange={e => setForm(f => ({ ...f, did_not_finish: e.target.checked }))} className="accent-warn" />
        DNF
      </label>
    </>
  );

  // Surface "X of Y finished" so the user can see progress through a
  // collection at a glance. DNF counts as accounted-for, so the count
  // reflects "stories closed out" rather than "stories rated 5 stars."
  const accounted = stories.filter(s => s.status === 'finished' || s.did_not_finish).length;
  return (
    <div className="border-t border-neutral-800 pt-5 mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Contents</p>
        {stories.length > 0 && (
          <p className="text-[10px] text-neutral-600 tabular-nums">
            {accounted} of {stories.length} finished
          </p>
        )}
      </div>
      {stories.length > 0 ? (
        <div className="space-y-2 mb-3">
          {stories.map(s => editId === s.id ? (
            <form key={s.id} onSubmit={e => handleUpdate(e, s.id)} className="flex flex-wrap items-center gap-2">
              {formBody}
              <button type="submit" disabled={saving} className="text-xs text-oak hover:text-oak/80 transition-colors disabled:opacity-40">Save</button>
              <button type="button" onClick={cancel} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">Cancel</button>
            </form>
          ) : (
            <div key={s.id} className="flex items-center gap-2 group text-xs">
              {s.position != null && (
                <span className="text-neutral-700 w-6 text-right flex-shrink-0 tabular-nums">{s.position}.</span>
              )}
              <button
                onClick={() => cycleStatus(s)}
                className={`uppercase tracking-wider px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  s.status === 'finished' ? 'bg-binding/30 text-leather hover:bg-binding/40'
                    : s.status === 'reading' ? 'bg-oak/30 text-parchment hover:bg-oak/40'
                    : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700'
                }`}
                title={`Click to cycle status (currently ${STATUS_LABEL[s.status]})`}
              >
                {STATUS_LABEL[s.status]}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-neutral-300 truncate" title={s.title}>{s.title}</p>
                {(() => {
                  // Compose a single dim subline: page range, year, then
                  // explicit story authors when they differ from the
                  // book's, then freeform notes. Each piece is optional;
                  // pieces are joined with " · " so the layout reads
                  // naturally.
                  const overrideAuthors = s.authors?.length ? authorText(s, []) : null;
                  const yearText = s.year_published != null ? String(s.year_published) : null;
                  const parts = [pageRangeText(s), yearText, overrideAuthors, s.notes].filter(Boolean);
                  if (!parts.length) return null;
                  const text = parts.join(' · ');
                  return <p className="text-neutral-600 text-[10px] truncate" title={text}>{text}</p>;
                })()}
              </div>
              {s.rating != null && (
                <span className="text-oak/70 flex-shrink-0">{'★'.repeat(Math.floor(s.rating))}{s.rating % 1 ? '½' : ''}</span>
              )}
              {s.date_finished && (
                <span className="text-neutral-600 flex-shrink-0">{formatPartialDate(s.date_finished)}</span>
              )}
              {s.did_not_finish ? (
                <span className="text-[10px] uppercase tracking-wider text-warn/80 border border-warn/30 rounded px-1 py-px flex-shrink-0">DNF</span>
              ) : null}
              <button onClick={() => startEdit(s)} className="text-neutral-700 hover:text-neutral-400 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-all flex-shrink-0">Edit</button>
              <button onClick={() => handleDelete(s.id, s.title)} className="text-neutral-700 hover:text-warn opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-all flex-shrink-0">×</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-600 mb-3">No stories logged yet.</p>
      )}
      {adding ? (
        <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
          {formBody}
          <button type="submit" disabled={saving} className="text-xs text-oak hover:text-oak/80 transition-colors disabled:opacity-40">Add</button>
          <button type="button" onClick={cancel} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">Cancel</button>
        </form>
      ) : (
        <button onClick={startAdd} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
          + Add story
        </button>
      )}
      {error && <p className="text-xs text-warn mt-2">{error}</p>}
    </div>
  );
}
