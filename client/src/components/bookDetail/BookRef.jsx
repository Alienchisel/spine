import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';

// Shared across all BookRef instances on the page so each #ID is fetched
// once. Map values: a resolved title string, `null` sentinel for "not
// found", or an in-flight Promise.
const titleCache = new Map();

function fetchTitle(id) {
  const v = titleCache.get(id);
  if (v !== undefined) return v instanceof Promise ? v : Promise.resolve(v);
  const p = api.getBook(id)
    .then(b => { titleCache.set(id, b.title); return b.title; })
    .catch(() => { titleCache.set(id, null); return null; });
  titleCache.set(id, p);
  return p;
}

export default function BookRef({ id, fromState }) {
  const cached = titleCache.get(id);
  const initial = (typeof cached === 'string' || cached === null) ? cached : undefined;
  const [title, setTitle] = useState(initial);

  useEffect(() => {
    if (title !== undefined) return;
    let cancelled = false;
    fetchTitle(id).then(t => { if (!cancelled) setTitle(t); });
    return () => { cancelled = true; };
  }, [id, title]);

  if (title === null) {
    return (
      <span className="text-neutral-700" title={`Book #${id} not found`}>#{id}</span>
    );
  }
  return (
    <Link
      to={`/books/${id}`}
      state={fromState}
      title={`#${id}`}
      className="text-neutral-200 hover:text-parchment underline decoration-neutral-700 hover:decoration-neutral-500 underline-offset-2 transition-colors"
    >
      {title ?? `#${id}`}
    </Link>
  );
}
