import { useEffect, useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { formatAuthors, initialsFor } from '../utils.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

// Deck-of-cards data-entry wizard. Drives bulk-clearing of a single
// audit row by presenting one missing-data book at a time with a small
// fixed set of option buttons + Skip. The first wizard (and proof of
// concept) is `binding` — fed by Audit's "Physical books have binding"
// row. Other wizards can register here as additional WIZARDS entries.
//
// Design choices the wizard frame commits to:
//   - Skip is first-class — same size + adjacency as the choice
//     buttons. The path of least resistance must not be a guess.
//   - Session-only skip memory. A book skipped this session stays out
//     of rotation until the wizard is reopened, so the user doesn't
//     bounce off the same "I can't tell" card. The audit count still
//     includes them; next visit they come back fresh.
//   - Keyboard shortcuts (1..N for options, S or N for skip) because
//     the whole point is throughput. Click-only support would defeat
//     the bulk-entry framing.

const WIZARDS = {
  binding: {
    title: 'Set binding',
    audit: 'Physical books have binding',
    field: 'binding',
    fetch: () => api.getBooks({ formats: 'physical', missing: 'binding', limit: 200, sort: 'random' }),
    // Options render left-to-right. Order picked to surface the most
    // common case first (paperback dominates the library by volume).
    options: [
      { value: 'paperback', label: 'Paperback' },
      { value: 'hardcover', label: 'Hardcover' },
      { value: 'other',     label: 'Other' },
    ],
  },
};

function shuffle(arr) {
  // Fisher-Yates in-place. The fetch may not return books in a
  // randomised order, and a stable order would make the bulk-entry
  // pass feel like a march through alphabetical pages.
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function AuditWizard() {
  const { key } = useParams();
  const navigate = useNavigate();
  const cfg = WIZARDS[key];

  const [pool, setPool] = useState(null);     // null = loading
  const [idx, setIdx]   = useState(0);
  const [filled, setFilled]   = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError]     = useState(null);
  const saveGuard = useActionGuard();

  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    cfg.fetch().then(r => {
      if (cancelled) return;
      setPool(shuffle(r.books ?? []));
      setIdx(0);
      setFilled(0);
      setSkipped(0);
    }).catch(() => {
      if (cancelled) return;
      setError('Failed to load books for the wizard.');
    });
    return () => { cancelled = true; };
  }, [cfg, key]);

  const current = pool && idx < pool.length ? pool[idx] : null;

  function advance() {
    setIdx(i => i + 1);
    setError(null);
  }

  async function pick(value) {
    if (!current) return;
    if (!saveGuard.begin()) return;
    setError(null);
    try {
      await api.patchBook(current.id, { [cfg.field]: value });
      setFilled(n => n + 1);
      advance();
    } catch {
      setError('Failed to save — try again or skip.');
    } finally {
      saveGuard.end();
    }
  }

  function skip() {
    if (saveGuard.busy) return;
    setSkipped(n => n + 1);
    advance();
  }

  // Keyboard shortcuts for throughput: 1..N pick the matching option,
  // S or → skip. Number range capped to the actual options length so
  // a stray 4-key press doesn't fire something undefined.
  useEffect(() => {
    if (!cfg || !current) return undefined;
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= cfg.options.length) {
        e.preventDefault();
        pick(cfg.options[n - 1].value);
        return;
      }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); skip(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!cfg) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <p role="alert" className="text-sm text-warn">Unknown wizard: <code>{key}</code></p>
        <Link to="/audit" className="text-xs text-neutral-500 hover:text-neutral-200">← Back to Audit</Link>
      </div>
    );
  }

  if (pool === null) {
    return <div role="status" className="text-neutral-700 text-sm">Loading wizard…</div>;
  }

  const done = idx >= pool.length;
  const total = pool.length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">{cfg.title}</h1>
        <Link to="/audit" className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors">
          ← Back to Audit
        </Link>
      </div>

      <p className="text-xs text-neutral-500">
        Bulk-clear the <span className="text-neutral-300">{cfg.audit}</span> audit one card at a time.
        {total > 0 && ` Pool of ${total} loaded this session.`}
      </p>

      {/* Progress strip — always visible so the user can pace themselves
          and notice their own skip ratio. */}
      <div className="flex items-center gap-6 text-xs text-neutral-500 tabular-nums border-y border-neutral-800 py-2">
        <span><span className="text-parchment">{filled}</span> filled</span>
        <span><span className="text-neutral-400">{skipped}</span> skipped</span>
        <span className="ml-auto"><span className="text-neutral-400">{Math.max(0, total - idx)}</span> remaining</span>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {done ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-2xl font-slab text-parchment">Done for this session.</p>
          <p className="text-sm text-neutral-500">
            Filled {filled}, skipped {skipped}.
            {total >= 200 && ' (200-card pool. Refresh to draw another batch.)'}
          </p>
          <div className="flex items-center justify-center gap-4 mt-6">
            <button type="button" onClick={() => navigate(0)} className="text-sm text-neutral-400 hover:text-parchment transition-colors">
              Refresh pool
            </button>
            <Link to="/audit" className="text-sm text-neutral-400 hover:text-parchment transition-colors">
              Back to Audit
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Card — cover + identifying metadata. Tight enough that the
              eye can take it in without scanning. Title links through
              to BookDetail in case the wizard isn't enough context. */}
          <div className="flex gap-5 items-start py-2">
            <div className="w-24 h-36 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
              {current.cover_path
                ? <img src={current.cover_path} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-xs text-neutral-500 font-medium tracking-wide">{initialsFor(current.title)}</div>}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <Link to={`/books/${current.id}`} className="text-base font-medium text-parchment hover:text-oak transition-colors block">
                {current.title}
              </Link>
              {current.authors?.length > 0 && (
                <p className="text-sm text-neutral-400">{formatAuthors(current.authors.map(a => a.name))}</p>
              )}
              <p className="text-xs text-neutral-600">
                {[
                  current.publisher,
                  current.year_edition,
                  current.page_count ? `${current.page_count} pp` : null,
                ].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
          </div>

          {/* Choice row. Skip carries the same visual weight as the
              option buttons — the data-quality cost of a guessing
              bias outweighs the dopamine of clearing the count. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {cfg.options.map((opt, i) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => pick(opt.value)}
                disabled={saveGuard.busy}
                aria-label={`Set binding for ${current.title} to ${opt.label}`}
                className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-wait text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
              >
                <span>{opt.label}</span>
                <span className="text-[10px] text-neutral-500">{i + 1}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={skip}
              disabled={saveGuard.busy}
              aria-label={`Skip ${current.title}`}
              className="px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-400 hover:text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
            >
              <span>Skip</span>
              <span className="text-[10px] text-neutral-600">S</span>
            </button>
          </div>

          <p className="text-[10px] text-neutral-600 text-center">
            Keyboard: {cfg.options.map((_, i) => i + 1).join(' / ')} to choose, S to skip
          </p>
        </>
      )}
    </div>
  );
}
