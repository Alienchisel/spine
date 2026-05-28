import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { formatAuthors, formatPartialDate, initialsFor, MOD_KEY } from '../../utils.js';
import { useActionGuard } from '../../hooks/useActionGuard.js';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import { WIZARDS, shuffle, clearDraft, clearAllDrafts } from './wizards.js';
import EnumModeButtons from './EnumModeButtons.jsx';
import TextModeForm from './TextModeForm.jsx';
import CoverModeGrid from './CoverModeGrid.jsx';

// Deck-of-cards data-entry wizard. Drives bulk-clearing of a single
// audit row by presenting one missing-data book at a time with a small
// fixed set of option buttons + Skip.
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
//
// This file is the orchestrator: pool fetch, idx/filled/skipped state,
// keyboard handler, undo, and the per-mode <ModeForm /> renders. The
// three mode subcomponents own their own per-card UI state.
export default function AuditWizard() {
  const { wizardKey } = useParams();
  const cfg = WIZARDS[wizardKey];

  const [pool, setPool] = useState(null);     // null = loading
  const [idx, setIdx]   = useState(0);
  const [filled, setFilled]   = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError]     = useState(null);
  // Bumped by Refresh pool to re-run the fetch effect without a full
  // route reload (navigate(0) would re-mount everything and re-fetch
  // any other route data). Toggling this is enough to draw a new batch.
  const [refreshTick, setRefreshTick] = useState(0);
  // Single-step undo: the position + action of the most recent
  // fill/skip. Cleared after use; we don't keep a stack because the
  // card-deck flow is forward-driven and a multi-step undo would
  // mostly invite cascading regret-clicks.
  const [lastAction, setLastAction] = useState(null);
  // Autocomplete suggestions for people fields. Fetched once when the
  // wizard mounts (a wizard's people fields don't change mid-session).
  // Shape matches /api/books/facets: { authors, narrators, translators }.
  const [suggestions, setSuggestions] = useState(null);
  const saveGuard = useActionGuard();

  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    const needsSuggestions = cfg.fields?.some(f => f.type === 'people');
    Promise.all([
      cfg.fetch(),
      needsSuggestions ? api.getBookFacets() : Promise.resolve(null),
    ]).then(([arr, facets]) => {
      if (cancelled) return;
      setPool(shuffle(arr));
      setSuggestions(facets);
      setIdx(0);
      setFilled(0);
      setSkipped(0);
      setLastAction(null);
    }).catch(() => {
      if (cancelled) return;
      // Land in the Done view instead of leaving pool=null (which
      // keeps the "Loading wizard…" message visible forever). The
      // error banner tells the user what happened; Refresh pool
      // gives them a retry path.
      setPool([]);
      setError('Failed to load records for the wizard.');
    });
    return () => { cancelled = true; };
  }, [cfg, wizardKey, refreshTick]);

  const current = pool && idx < pool.length ? pool[idx] : null;

  function advance() {
    setIdx(i => i + 1);
    setError(null);
  }

  async function pick(value) {
    if (!current) return;
    if (!saveGuard.begin()) return;
    setError(null);
    const actionIdx = idx;
    const actionId  = current.id;
    try {
      await cfg.patch(current.id, value);
      setFilled(n => n + 1);
      setLastAction({ index: actionIdx, type: 'fill' });
      // Text-mode drafts are stored per card while the user types.
      // Clear ours now that the server has the committed value; if
      // the user hits Undo, they'll see the cleared server state and
      // not a stale local draft.
      if (cfg.mode === 'text') clearDraft(wizardKey, actionId);
      advance();
    } catch (err) {
      // Surface the API's actual error (e.g. "Invalid ISBN-13",
      // "Series number must be a multiple of 0.5", "Invalid birth_date")
      // so users can correct the input instead of guessing at why a
      // generic "Failed to save" appeared. The isbn wizard's own
      // client-side reject for non-10/13 length also flows through here.
      setError(err?.message || 'Failed to save — try again or skip.');
    } finally {
      saveGuard.end();
    }
  }

  async function pickCover(candidate) {
    if (!current) return;
    if (!saveGuard.begin()) return;
    setError(null);
    const actionIdx = idx;
    try {
      await cfg.commitCandidate(current, candidate);
      setFilled(n => n + 1);
      setLastAction({ index: actionIdx, type: 'fill' });
      advance();
    } catch (err) {
      setError(err?.message || 'Failed to set image. Try another candidate or skip.');
    } finally {
      saveGuard.end();
    }
  }

  function skip() {
    if (saveGuard.busy) return;
    setSkipped(n => n + 1);
    setLastAction({ index: idx, type: 'skip' });
    advance();
  }

  // Single-step undo. Fills revert via a PATCH that clears the field
  // (empty string → server's existing patchBook treats as null); skips
  // are local-only so we just decrement the counter. Either way, idx
  // rewinds to the previous card so the user can re-decide.
  async function undo() {
    // Pool is null during initial load and between Refresh-pool click
    // and the fetch resolving; lastAction can still be set from the
    // previous pool. Bail rather than crashing on pool[index].
    if (!lastAction || saveGuard.busy || !pool) return;
    const { index, type } = lastAction;
    if (type === 'fill') {
      if (!saveGuard.begin()) return;
      setError(null);
      try {
        const target = pool[index];
        if (cfg.mode === 'cover') {
          // Cover-mode owns its own clear path (server endpoint, file
          // deletion). It doesn't go through cfg.patch.
          await cfg.clearCandidate(target);
        } else {
          // Text-mode auto-derives a clear payload from the fields list:
          // people fields get an empty array (clears the join table);
          // text/number fields get an empty string (server coerces to
          // null). Enum-mode uses the explicit clearValue.
          const clearPayload = cfg.mode === 'text'
            ? Object.fromEntries(cfg.fields.map(f => [f.name, f.type === 'people' ? [] : '']))
            : cfg.clearValue;
          await cfg.patch(target.id, clearPayload);
        }
        setFilled(n => n - 1);
      } catch (err) {
        setError(err?.message || 'Failed to undo — try again.');
        saveGuard.end();
        return;
      }
      saveGuard.end();
    } else {
      setSkipped(n => n - 1);
    }
    setIdx(index);
    setLastAction(null);
    setError(null);
  }

  // Keyboard shortcuts for throughput: 1..N pick the matching option,
  // S to skip, U to undo. The latest-handler-ref pattern lets the
  // listener attach exactly once (on mount, detach on unmount) while
  // still calling through to a closure that sees the freshest
  // cfg/current/lastAction/pick/skip/undo on every keystroke.
  const onKeyRef = useRef(null);
  onKeyRef.current = function onKey(e) {
    if (!cfg) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Number-row shortcuts only apply to enum-mode wizards. Text-mode
    // wizards have no options array; the Save / Skip flow uses Enter
    // (form submit, handled natively) and Esc (input onKeyDown).
    if (cfg.mode === 'enum' || cfg.mode === undefined) {
      const raw = parseInt(e.key, 10);
      // When a wizard has 10 options (rating), `0` maps to the 10th —
      // 1..9 then 0 is the natural number-row layout.
      const n = (raw === 0 && cfg.options.length === 10) ? 10 : raw;
      if (!Number.isNaN(n) && n >= 1 && n <= cfg.options.length && current) {
        e.preventDefault();
        pick(cfg.options[n - 1].value);
        return;
      }
    }
    // Skip via S works in any non-text mode (text uses Esc on the
    // focused input). Cover mode wants S too; enum mode wants S too.
    if (cfg.mode !== 'text' && e.key.toLowerCase() === 's' && current) {
      e.preventDefault(); skip(); return;
    }
    if (e.key.toLowerCase() === 'u' && lastAction) { e.preventDefault(); undo(); }
  };
  useEffect(() => {
    const listener = (e) => onKeyRef.current?.(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (!cfg) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <p role="alert" className="text-sm text-warn">Unknown wizard: <code>{wizardKey}</code></p>
        <Link to="/audit" className="text-xs text-neutral-500 hover:text-neutral-200">← Back to Audit</Link>
      </div>
    );
  }

  if (pool === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="text-neutral-500 text-sm animate-pulse"
      >
        Loading wizard…
      </div>
    );
  }

  const done = idx >= pool.length;
  const total = pool.length;
  const busy  = saveGuard.busy;

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
          and notice their own skip ratio. Undo lives here, anchored to
          the counters that change. Hidden until there's an action to
          undo so it doesn't look like a stray control. */}
      <div className="flex items-center gap-6 text-xs text-neutral-500 tabular-nums border-y border-neutral-800 py-2">
        <span><span className="text-parchment">{filled}</span> filled</span>
        <span><span className="text-neutral-400">{skipped}</span> skipped</span>
        {lastAction && (
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            className="text-neutral-500 hover:text-parchment disabled:opacity-40 transition-colors"
            aria-label={`Undo last ${lastAction.type}`}
          >
            ← Undo
          </button>
        )}
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
            <button
              type="button"
              onClick={() => {
                // Clearing lastAction is defense in depth: undo's own
                // guard bails when pool is null, but resetting here also
                // hides the Undo button immediately so the UI can't lie
                // about being able to revert against a stale pool.
                setPool(null);
                setError(null);
                setLastAction(null);
                // Sweep all text-mode drafts for this wizardKey — the
                // new pool draws different records, so any half-typed
                // bios from the previous session are contextually
                // orphaned. Keeping them would silently re-hydrate a
                // bio meant for a different author if the same id
                // happened to come back.
                clearAllDrafts(wizardKey);
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
          {/* Card — cover/portrait + identifying metadata. Layout
              branches on cfg.kind: books get a 2:3 cover and a
              publisher/year/pages line; authors get a square portrait,
              dates, and a book-count + bio snippet. Both link through
              to the record's detail page in case the wizard's snapshot
              isn't enough context. */}
          <div className="flex gap-5 items-start py-2">
            {cfg.kind === 'author' ? (
              <div className="w-24 h-24 flex-shrink-0 rounded-full overflow-hidden bg-neutral-800">
                {current.photo_path
                  ? <img src={current.photo_path} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-xs text-neutral-500 font-medium tracking-wide">{initialsFor(current.name)}</div>}
              </div>
            ) : (
              <div className="w-24 h-36 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
                {current.cover_path
                  ? <img src={current.cover_path} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-xs text-neutral-500 font-medium tracking-wide">{initialsFor(current.title)}</div>}
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <Link to={cfg.getLink(current)} className="text-base font-medium text-parchment hover:text-oak transition-colors inline-block">
                {cfg.getName(current)}
              </Link>
              {cfg.kind === 'author' ? (
                <>
                  {(current.birth_date || current.death_date) && (
                    <p className="text-sm text-neutral-400">
                      {formatPartialDate(current.birth_date) || '?'} – {formatPartialDate(current.death_date) || ''}
                    </p>
                  )}
                  <p className="text-xs text-neutral-600">
                    {[
                      current.book_count ? `${current.book_count} book${current.book_count === 1 ? '' : 's'}` : null,
                      current.story_count ? `${current.story_count} stor${current.story_count === 1 ? 'y' : 'ies'}` : null,
                    ].filter(Boolean).join(' · ') || '—'}
                  </p>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>

          {/* Choice row. Skip carries the same visual weight as the
              option buttons / Save — the data-quality cost of a
              guessing bias outweighs the dopamine of clearing the
              count. */}
          {cfg.mode === 'text' ? (
            <TextModeForm
              cfg={cfg}
              wizardKey={wizardKey}
              current={current}
              busy={busy}
              suggestions={suggestions}
              onPick={pick}
              onSkip={skip}
            />
          ) : cfg.mode === 'cover' ? (
            <CoverModeGrid
              cfg={cfg}
              current={current}
              busy={busy}
              onPick={pickCover}
              onSkip={skip}
            />
          ) : (
            <EnumModeButtons
              cfg={cfg}
              current={current}
              busy={busy}
              onPick={pick}
              onSkip={skip}
            />
          )}

          <p className="text-[10px] text-neutral-600 text-center">
            Keyboard: {cfg.mode === 'text'
              ? `${cfg.fields.some(f => f.multiline || f.type === 'people') ? `${MOD_KEY}+Enter` : 'Enter'} to save, Esc to skip, U to undo`
              : cfg.mode === 'cover'
                ? 'Click a thumbnail to set, S to skip, U to undo'
                : `${cfg.options.map((_, i) => i === 9 && cfg.options.length === 10 ? '0' : i + 1).join(' / ')} to choose, S to skip, U to undo`}
          </p>
        </>
      )}
    </div>
  );
}
