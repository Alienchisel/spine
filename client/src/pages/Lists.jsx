import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { plural } from '../utils.js';
import { useConfirm } from '../components/ConfirmModal.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';

export default function Lists() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const createGuard = useActionGuard();
  const [createError, setCreateError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const inputRef = useRef(null);
  const confirm = useConfirm();
  // Bumped on every load so an in-flight handleCreate whose POST resolves
  // *after* a refresh-tick reload (which already picked up the new list)
  // can detect the change and skip the optimistic append — without this,
  // the success-path setLists would graft `created` onto a fresh list that
  // already contains it, producing a duplicate row until the next reload.
  const guard = useStaleGuard();
  // Tracks list ids whose delete is in flight. The confirm modal cancels
  // overlapping confirms, but a re-click *after* confirming — while the
  // API call is pending and setLists hasn't yet filtered the row out —
  // fires a duplicate deleteList that 404s and surfaces "Failed to delete
  // list." on a list that did delete. Mirrors the pattern in ReadsSection
  // and Diary.
  const deletingIdsRef = useRef(new Set());
  const refreshTick = useRefreshTick();

  useEffect(() => {
    const epoch = guard.next();
    // Drop any lingering create/delete banner at the start of a fresh
    // load so a refresh-tick reload doesn't leave a stale "Failed to …"
    // sitting in the strip below the create form.
    setCreateError(null);
    setDeleteError(null);
    api.getLists()
      .then(ls => { if (guard.isFresh(epoch)) { setLists(ls); setError(null); } })
      .catch(() => { if (guard.isFresh(epoch)) setError('Failed to load lists.'); })
      .finally(() => { if (guard.isFresh(epoch)) setLoading(false); });
  }, [refreshTick]);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    // Mirror the disabled button so an Enter-key submit while a create
    // is in flight can't race a duplicate POST.
    if (!createGuard.begin()) return;
    setCreateError(null);
    // createError and deleteError both render in the strip just below the
    // create form, so a stale message from the other handler would sit
    // visible alongside a successful action. Clear both on entry from each
    // handler so the visible state always matches the most recent action.
    setDeleteError(null);
    const epoch = guard.current();
    try {
      const created = await api.createList(name);
      // If a refresh-tick reload landed mid-flight, it already includes
      // `created` — appending again would duplicate the row. The reload
      // is the authoritative source so just trust it and skip the append.
      if (!guard.isFresh(epoch)) {
        setNewName('');
        inputRef.current?.focus();
        return;
      }
      setLists(ls => [...ls, { ...created, book_count: 0, owned_count: 0, finished_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      inputRef.current?.focus();
    } catch (err) {
      if (!guard.isFresh(epoch)) return;
      setCreateError(err?.message || 'Failed to create list.');
    } finally {
      createGuard.end();
    }
  }

  async function handleDelete(list) {
    if (deletingIdsRef.current.has(list.id)) return;
    const msg = list.book_count > 0
      ? `Delete "${list.name}"? It contains ${plural(list.book_count, 'book')}.`
      : `Delete "${list.name}"?`;
    if (!await confirm(msg)) return;
    if (deletingIdsRef.current.has(list.id)) return;
    deletingIdsRef.current.add(list.id);
    setDeleteError(null);
    setCreateError(null);
    try {
      await api.deleteList(list.id);
      setLists(ls => ls.filter(l => l.id !== list.id));
    } catch {
      setDeleteError('Failed to delete list.');
    } finally {
      deletingIdsRef.current.delete(list.id);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">Lists</h1>

      <form onSubmit={handleCreate} className="flex items-center gap-2 mb-8">
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          aria-label="New list name"
          placeholder="New list name…"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors w-72"
        />
        <button
          type="submit"
          disabled={createGuard.busy || !newName.trim()}
          className="text-sm font-medium bg-oak hover:bg-leather disabled:opacity-40 motion-safe:active:scale-[0.98] text-neutral-950 px-4 py-2 rounded-lg transition-[transform,background-color] ease-out duration-150"
        >
          Create
        </button>
        {createError && <span role="alert" className="text-xs text-red-400">{createError}</span>}
      </form>

      {deleteError && <p role="alert" className="text-xs text-warn mb-4">{deleteError}</p>}

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div role="alert" className="text-red-500 text-sm">{error}</div>
      ) : lists.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600">No lists yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {lists.map(list => (
            <div
              key={list.id}
              className="flex items-center gap-4 px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-colors group"
            >
              <Link to={`/lists/${list.id}`} className="flex-1 min-w-0">
                <span className="text-sm font-medium text-neutral-200 group-hover:text-white transition-colors">
                  {list.name}
                </span>
              </Link>
              <span className="text-xs text-neutral-600 flex-shrink-0">
                {plural(list.book_count, 'book')}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(list)}
                className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100"
                title="Delete list"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
