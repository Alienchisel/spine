import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { plural } from '../utils.js';
import { useConfirm } from '../components/ConfirmModal.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActionGuard } from '../hooks/useActionGuard.js';
import PageHeading from '../components/PageHeading.jsx';
import { primaryButton } from '../components/buttonStyles.js';

export default function Lists() {
  const queryClient = useQueryClient();
  const listsQ = useQuery({
    queryKey: ['lists', 'all'],
    queryFn: () => api.getLists(),
    placeholderData: (prev) => prev ?? [],
  });
  const lists   = listsQ.data ?? [];
  const loading = listsQ.isPending;
  const error   = listsQ.error;
  const setLists = (updater) => {
    queryClient.setQueryData(
      ['lists', 'all'],
      (prev) => (typeof updater === 'function' ? updater(prev ?? []) : updater),
    );
  };
  const [newName, setNewName] = useState('');
  const createGuard = useActionGuard();
  const [createError, setCreateError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const inputRef = useRef(null);
  const confirm = useConfirm();
  // Tracks list ids whose delete is in flight. The confirm modal cancels
  // overlapping confirms, but a re-click *after* confirming — while the
  // API call is pending and setLists hasn't yet filtered the row out —
  // fires a duplicate deleteList that 404s and surfaces "Failed to delete
  // list." on a list that did delete. Mirrors the pattern in ReadsSection
  // and Diary.
  const deletingIdsRef = useRef(new Set());
  // Drop any lingering create/delete banner whenever a refresh-tick reload
  // lands so a stale "Failed to …" doesn't sit below the create form.
  useEffect(() => {
    setCreateError(null);
    setDeleteError(null);
  }, [lists]);

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
    try {
      const created = await api.createList(name);
      // Dedupe by id when grafting `created` onto the visible list — a
      // refresh-tick reload that landed mid-flight already includes it,
      // and appending again would duplicate the row. Comparing by id
      // works regardless of timing (replaces the prior gen-counter race
      // check, which only caught the narrow "tick fired before this
      // setLists ran" window).
      setLists(ls => ls.find(l => l.id === created.id)
        ? ls
        : [...ls, { ...created, book_count: 0, owned_count: 0, finished_count: 0 }]
            .sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      inputRef.current?.focus();
    } catch (err) {
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
      <div className="mb-6"><PageHeading>Lists</PageHeading></div>

      <form onSubmit={handleCreate} className="flex items-center gap-2 mb-8">
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          aria-label="New list name"
          placeholder="New list name…"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors w-72"
        />
        <button
          type="submit"
          disabled={createGuard.busy || !newName.trim()}
          className={primaryButton}
        >
          Create
        </button>
        {createError && <span role="alert" className="text-xs text-warn">{createError}</span>}
      </form>

      {deleteError && <p role="alert" className="text-xs text-warn mb-4">{deleteError}</p>}

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div role="alert" className="text-warn text-sm">Failed to load lists.</div>
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
              <Link
                to={`/lists/${list.id}`}
                className="flex-1 min-w-0 text-sm font-medium text-neutral-200 group-hover:text-white transition-colors"
                title={list.description || undefined}
              >
                {list.name}
              </Link>
              <span className="text-xs text-neutral-600 flex-shrink-0">
                {plural(list.book_count, 'book')}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(list)}
                className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100"
                title="Delete list"
                aria-label={`Delete list ${list.name}`}
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
