import { useEffect, useRef, useState } from 'react';
import { MOD_KEY } from '../../utils.js';

// Cover-mode wizard: refine-query input + grid of candidate thumbnails
// pulled per card via the wizard's source-specific search function
// (api.searchBooks for book covers, api.searchAuthorsOL for author
// portraits). Owns its own candidates/loading/error/coverQuery/
// failedThumbs state since none of that is shared with other modes.
//
// Candidate normalisation happens in the wizard config's searchCandidates:
// each candidate is { thumbnail_url, label, source_url } regardless of
// source, so this component stays source-agnostic.
//
// Paste-anywhere shortcut: a clipboard image (Cmd/Ctrl+V from a
// screenshot, an image copied off the web, etc.) goes straight through
// the wizard's commitCandidate as a polymorphic `source_file` candidate,
// skipping the OL-search-pick flow entirely. Mirrors BookDetail's
// paste-to-upload-cover behaviour. The listener is gated to skip text
// fields (the refine-query input above the grid) so typing isn't
// hijacked.
export default function CoverModeGrid({ cfg, current, busy, onPick, onSkip }) {
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState(null);
  const [coverQuery, setCoverQuery] = useState('');
  // Indices of candidates whose <img> 404'd or failed to decode. Tiles
  // for those indices are dropped from the rendered grid so OL
  // placeholder results (we pass `?default=false` server-side so missing
  // photos 404 cleanly) and broken thumbnails don't take up space.
  const [failedThumbs, setFailedThumbs] = useState(() => new Set());
  const inputRef = useRef(null);
  // Tracks Tailwind's `sm` breakpoint (640px) — drives the cap on visible
  // candidates so the Skip button stays in view regardless of breakpoint.
  // Grid is grid-cols-3 below sm, grid-cols-4 at sm+, so 6 vs 8 = 2 rows.
  const [isSmUp, setIsSmUp] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 640px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = (e) => setIsSmUp(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const maxTiles = isSmUp ? 8 : 6;

  // Auto-search per card. Initial query comes from cfg.initialQuery(record).
  useEffect(() => {
    if (!current) return;
    const initial = cfg.initialQuery(current);
    setCoverQuery(initial);
    setCandidates([]);
    setCandidatesError(null);
    setFailedThumbs(new Set());
    inputRef.current?.focus();
    if (!initial.trim()) return;
    setCandidatesLoading(true);
    let cancelled = false;
    cfg.searchCandidates(initial)
      .then(results => {
        if (cancelled) return;
        setCandidates(results || []);
      })
      .catch(() => {
        if (cancelled) return;
        setCandidatesError('Search failed. Try refining the query.');
      })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [cfg, current?.id]);

  // Paste-anywhere: clipboard image → synthetic source_file candidate
  // that the wizard config's commitCandidate uploads + patches. Skips
  // the OL-search-pick flow entirely. Gated to ignore pastes into text
  // fields so the refine-query input stays normal.
  useEffect(() => {
    function onPaste(e) {
      const tag = e.target.tagName;
      const isTextField = (tag === 'INPUT' && e.target.type !== 'file') || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isTextField) return;
      if (busy) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            onPick({ source_file: file, label: file.name || 'Pasted image' });
            return;
          }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [busy, onPick]);

  async function rerunCoverSearch() {
    if (!coverQuery.trim()) return;
    setCandidatesLoading(true);
    setCandidatesError(null);
    setCandidates([]);
    setFailedThumbs(new Set());
    try {
      const results = await cfg.searchCandidates(coverQuery);
      setCandidates(results || []);
    } catch {
      setCandidatesError('Search failed. Try refining the query.');
    } finally {
      setCandidatesLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Refine query — pre-populated from {title} {surname} but user
          can rewrite if the auto-search missed (common with subtitled
          titles or single-name authors). Disabled during commit so a
          stray Enter can't clobber candidates mid-upload. */}
      <form
        onSubmit={e => { e.preventDefault(); rerunCoverSearch(); }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={coverQuery}
          onChange={e => setCoverQuery(e.target.value)}
          placeholder="Search query"
          aria-label="Cover search query"
          disabled={busy}
          className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={candidatesLoading || busy || !coverQuery.trim()}
          className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-60 text-parchment text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak/50"
        >
          Search
        </button>
      </form>
      {/* Paste hint — low-emphasis, just enough to surface the shortcut
          to users who don't know it exists. */}
      <p className="text-[11px] text-neutral-700 -mt-1">
        …or paste an image (<kbd className="font-sans border border-neutral-800 rounded px-1 py-px text-neutral-600">{MOD_KEY}+V</kbd>) to set the cover directly.
      </p>

      {candidatesLoading && <p role="status" className="text-xs text-neutral-500">Searching…</p>}
      {candidatesError && <p role="alert" className="text-xs text-warn">{candidatesError}</p>}
      {!candidatesLoading && !candidatesError && candidates.length === 0 && (
        <p className="text-xs text-neutral-500">No cover candidates. Try refining the query or skip.</p>
      )}

      {candidates.length > 0 && (() => {
        const visible = candidates
          .map((c, i) => ({ c, i }))
          .filter(({ i }) => !failedThumbs.has(i))
          .slice(0, maxTiles);
        if (visible.length === 0) {
          return <p className="text-xs text-neutral-500">No real images returned. Try refining the query or skip.</p>;
        }
        return (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {visible.map(({ c, i }) => (
              <button
                key={`${c.source_url}-${i}`}
                type="button"
                onClick={() => onPick(c)}
                disabled={busy}
                aria-label={`Use image: ${c.label || 'unlabelled candidate'}`}
                title={c.label || ''}
                className={`bg-neutral-800 rounded overflow-hidden ring-1 ring-transparent hover:ring-oak focus:outline-none focus:ring-2 focus:ring-oak/70 transition-all disabled:opacity-60 disabled:cursor-wait ${cfg.kind === 'author' ? 'aspect-square' : 'aspect-[2/3]'}`}
              >
                <img
                  src={c.thumbnail_url}
                  alt=""
                  onError={() => setFailedThumbs(prev => {
                    const next = new Set(prev);
                    next.add(i);
                    return next;
                  })}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        );
      })()}

      {/* Skip — equal-weight with the candidate clicks, same framing
          as the enum-mode wizard. */}
      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        aria-label={`Skip ${cfg.getName(current)}`}
        className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-60 text-neutral-400 hover:text-parchment text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 flex flex-col items-center gap-1"
      >
        <span>Skip</span>
        <span className="text-[10px] text-neutral-600">S</span>
      </button>
    </div>
  );
}
