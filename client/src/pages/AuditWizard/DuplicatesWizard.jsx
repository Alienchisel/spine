import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { formatAuthors, initialsFor } from '../../utils.js';
import { useActionGuard } from '../../hooks/useActionGuard.js';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import { shuffle } from './wizards.js';

// Duplicate / edition sweep — the cluster-shaped sibling of the
// card-per-record AuditWizard. One cluster (same article-stripped title
// + author set, not all in one work group) per card, with two
// resolutions mirroring the manual conventions:
//   - Link as editions: alternate editions worth keeping (different
//     translation, format, printing) get work-linked into one group.
//   - Merge: a true ingestion duplicate collapses into a chosen
//     survivor — the survivor keeps every field it has, the loser
//     fills the blanks, reads/tags/lists move over, then the loser is
//     deleted. Deletion is why merge takes a two-click confirm and why
//     this wizard has no Undo.
export default function DuplicatesWizard() {
  const [pool, setPool] = useState(null);   // null = loading
  const [idx, setIdx]   = useState(0);
  const [linked, setLinked]   = useState(0);
  const [merged, setMerged]   = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError]     = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // Per-card state, reset on advance. survivorId=null means "default to
  // the lowest id" (the older record, more likely to carry acquisition
  // history — same default as the manual merge convention).
  const [survivorId, setSurvivorId] = useState(null);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const guard = useActionGuard();

  useEffect(() => {
    let cancelled = false;
    api.getDuplicateClusters().then(arr => {
      if (cancelled) return;
      setPool(shuffle(arr));
      setIdx(0);
      setLinked(0);
      setMerged(0);
      setSkipped(0);
    }).catch(() => {
      if (cancelled) return;
      setPool([]);
      setError('Failed to load duplicate clusters.');
    });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const current = pool && idx < pool.length ? pool[idx] : null;
  const effectiveSurvivor = current
    ? (survivorId ?? Math.min(...current.members.map(m => m.id)))
    : null;

  function advance() {
    setIdx(i => i + 1);
    setError(null);
    setSurvivorId(null);
    setConfirmingMerge(false);
  }

  async function linkAll() {
    if (!current || !guard.begin()) return;
    setError(null);
    try {
      // Pairwise from the first member; work-link transitivity (and
      // lower-id group merging) folds everything into one group even
      // when some members were already linked elsewhere.
      const [first, ...rest] = current.members;
      for (const m of rest) await api.linkEdition(first.id, m.id);
      setLinked(n => n + 1);
      advance();
    } catch (err) {
      setError(err?.message || 'Failed to link editions.');
    } finally {
      guard.end();
    }
  }

  async function doMerge() {
    if (!current || !guard.begin()) return;
    setError(null);
    try {
      const losers = current.members.filter(m => m.id !== effectiveSurvivor);
      for (const m of losers) await api.mergeBook(effectiveSurvivor, m.id);
      setMerged(n => n + 1);
      advance();
    } catch (err) {
      setError(err?.message || 'Merge failed — the cluster may be partially merged; check the records.');
      setConfirmingMerge(false);
    } finally {
      guard.end();
    }
  }

  function skip() {
    if (guard.busy) return;
    setSkipped(n => n + 1);
    advance();
  }

  // L = link, S = skip. Merge deliberately has no shortcut — it deletes
  // records and should stay a two-click pointer action.
  const onKeyRef = useRef(null);
  onKeyRef.current = function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!current) return;
    if (e.key.toLowerCase() === 'l') { e.preventDefault(); linkAll(); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); skip(); }
  };
  useEffect(() => {
    const listener = (e) => onKeyRef.current?.(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (pool === null) {
    return (
      <div role="status" aria-live="polite" className="text-neutral-500 text-sm animate-pulse">
        Loading wizard…
      </div>
    );
  }

  const done = idx >= pool.length;
  const total = pool.length;
  const busy = guard.busy;
  const loserCount = current ? current.members.length - 1 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Duplicates</h1>
        <Link to="/audit" className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors">
          ← Back to Audit
        </Link>
      </div>

      <p className="text-xs text-neutral-500">
        Books sharing a title and author set, not yet linked as editions.
        Link the alternate editions you keep on purpose; merge true duplicates into one record.
        {total > 0 && ` Pool of ${total} cluster${total === 1 ? '' : 's'} loaded this session.`}
      </p>

      <div className="flex items-center gap-6 text-xs text-neutral-500 tabular-nums border-y border-neutral-800 py-2">
        <span><span className="text-parchment">{linked}</span> linked</span>
        <span><span className="text-parchment">{merged}</span> merged</span>
        <span><span className="text-neutral-400">{skipped}</span> skipped</span>
        <span className="ml-auto"><span className="text-neutral-400">{Math.max(0, total - idx)}</span> remaining</span>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {done ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-2xl font-slab text-parchment">Done for this session.</p>
          <p className="text-sm text-neutral-500">
            Linked {linked}, merged {merged}, skipped {skipped}.
          </p>
          <div className="flex items-center justify-center gap-4 mt-6">
            <button
              type="button"
              onClick={() => {
                setPool(null);
                setError(null);
                setRefreshTick(t => t + 1);
              }}
              className="text-sm text-neutral-400 hover:text-parchment transition-colors"
            >
              Refresh pool
            </button>
            <Link to="/audit" className="text-sm text-neutral-400 hover:text-parchment transition-colors">
              Back to Audit
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <h2 className="text-base font-medium text-parchment">{current.title}</h2>
            {current.authors && (
              <p className="text-sm text-neutral-400">{formatAuthors(current.authors.split(' & '))}</p>
            )}
          </div>

          {/* Member rows — the fields most likely to distinguish a real
              edition pair from a phantom duplicate: publisher, format,
              year, translator, plus state badges. The radio picks the
              merge survivor; it has no effect on Link. */}
          <ul className="space-y-2" aria-label="Cluster members">
            {current.members.map(m => {
              const isSurvivor = m.id === effectiveSurvivor;
              const meta = [
                `#${m.id}`,
                m.publisher,
                m.format,
                m.year_edition || m.year_published,
                m.translators ? `tr. ${m.translators}` : null,
                m.rating != null ? `★ ${m.rating}` : null,
                m.read_count > 0 ? `read ×${m.read_count}` : null,
              ].filter(Boolean).join(' · ');
              const badges = [
                m.work_id != null ? { label: `group ${m.work_id}`, cls: 'text-sky-400/80 border-sky-400/30' } : null,
                m.archived ? { label: 'archived', cls: 'text-neutral-500 border-neutral-600' } : null,
                m.is_stub ? { label: 'wishlist', cls: 'text-amber-400/80 border-amber-400/30' } : null,
                !m.owned && !m.is_stub ? { label: 'unowned', cls: 'text-neutral-500 border-neutral-600' } : null,
              ].filter(Boolean);
              return (
                <li key={m.id}>
                  <label className={`flex gap-3 items-start rounded border px-3 py-2 cursor-pointer transition-colors ${
                    isSurvivor ? 'border-oak/60 bg-neutral-900/60' : 'border-neutral-800 hover:border-neutral-600'
                  }`}>
                    <input
                      type="radio"
                      name="merge-survivor"
                      checked={isSurvivor}
                      onChange={() => { setSurvivorId(m.id); setConfirmingMerge(false); }}
                      aria-label={`Keep #${m.id} as merge survivor`}
                      className="mt-1 accent-oak"
                    />
                    <div className="w-10 h-[60px] flex-shrink-0 rounded-sm overflow-hidden bg-neutral-800">
                      {m.cover_url
                        ? <img src={m.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-[10px] text-neutral-500 font-medium">{initialsFor(m.title)}</div>}
                    </div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/books/${m.id}`}
                          onClick={e => e.stopPropagation()}
                          className="text-sm text-parchment hover:text-oak transition-colors truncate"
                        >
                          {m.title}
                        </Link>
                        {badges.map(b => (
                          <span key={b.label} className={`text-[10px] px-1.5 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
                        ))}
                        {isSurvivor && <span className="text-[10px] text-oak">survivor</span>}
                      </div>
                      <p className="text-xs text-neutral-500">{meta || '—'}</p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={linkAll}
              disabled={busy}
              aria-label={`Link all ${current.members.length} records as editions of one work`}
              className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-60 disabled:cursor-wait text-parchment text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak/50 flex flex-col items-center gap-1"
            >
              <span>Link as editions</span>
              <span className="text-[10px] text-neutral-500">L</span>
            </button>
            <button
              type="button"
              onClick={() => (confirmingMerge ? doMerge() : setConfirmingMerge(true))}
              disabled={busy}
              aria-label={confirmingMerge
                ? `Confirm merge into #${effectiveSurvivor}, deleting ${loserCount} record${loserCount === 1 ? '' : 's'}`
                : `Merge duplicates into #${effectiveSurvivor}`}
              className={`px-4 py-3 disabled:opacity-60 disabled:cursor-wait text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-warn/50 flex flex-col items-center gap-1 ${
                confirmingMerge
                  ? 'bg-warn/20 border border-warn/60 text-warn hover:bg-warn/30'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-parchment'
              }`}
            >
              <span>{confirmingMerge ? 'Confirm merge' : `Merge into #${effectiveSurvivor}`}</span>
              <span className={`text-[10px] ${confirmingMerge ? 'text-warn/80' : 'text-neutral-500'}`}>
                {confirmingMerge
                  ? `deletes ${loserCount} record${loserCount === 1 ? '' : 's'} — cannot be undone`
                  : 'two-click confirm'}
              </span>
            </button>
            <button
              type="button"
              onClick={skip}
              disabled={busy}
              aria-label="Skip this cluster"
              className="px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-60 text-neutral-400 hover:text-parchment text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 flex flex-col items-center gap-1"
            >
              <span>Skip</span>
              <span className="text-[10px] text-neutral-600">S</span>
            </button>
          </div>

          <p className="text-[10px] text-neutral-600 text-center">
            Keyboard: L to link as editions, S to skip. Merge is click-only and asks twice.
          </p>
        </>
      )}
    </div>
  );
}
