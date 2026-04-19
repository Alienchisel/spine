import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Lists() {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.getLists()
      .then(setLists)
      .catch(() => setError('Failed to load lists.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createList(name);
      setLists(ls => [...ls, { ...created, book_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      inputRef.current?.focus();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id) {
    await api.deleteList(id);
    setLists(ls => ls.filter(l => l.id !== id));
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
          placeholder="New list name…"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors w-72"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="text-sm font-medium bg-oak hover:bg-leather disabled:opacity-40 active:scale-[0.98] text-neutral-950 px-4 py-2 rounded-lg transition-[transform,background-color] ease-out duration-150"
        >
          Create
        </button>
        {createError && <span className="text-xs text-red-400">{createError}</span>}
      </form>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div className="text-red-500 text-sm">{error}</div>
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
                {list.book_count} {list.book_count === 1 ? 'book' : 'books'}
              </span>
              <button
                onClick={() => handleDelete(list.id)}
                className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 opacity-0 group-hover:opacity-100"
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
