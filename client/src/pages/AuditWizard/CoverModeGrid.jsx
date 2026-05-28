import { useEffect, useRef, useState } from 'react';

// Cover-mode wizard: refine-query input + grid of candidate thumbnails
// pulled per card via the wizard's source-specific search function
// (api.searchBooks for book covers, api.searchAuthorsOL for author
// portraits). Owns its own candidates/loading/error/coverQuery/
// failedThumbs state since none of that is shared with other modes.
//
// Candidate normalisation happens in the wizard config's searchCandidates:
// each candidate is { thumbnail_url, label, source_url } regardless of
// source, so this component stays source-agnostic.
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
          className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={candidatesLoading || busy || !coverQuery.trim()}
          className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-parchment text-sm rounded transition-colors"
        >
          Search
        </button>
      </form>

      {candidatesLoading && <p role="status" className="text-xs text-neutral-500">Searching…</p>}
      {candidatesError && <p role="alert" className="text-xs text-warn">{candidatesError}</p>}
      {!candidatesLoading && !candidatesError && candidates.length === 0 && (
        <p className="text-xs text-neutral-500">No cover candidates. Try refining the query or skip.</p>
      )}

      {candidates.length > 0 && (() => {
        const visible = candidates
          .map((c, i) => ({ c, i }))
          .filter(({ i }) => !failedThumbs.has(i));
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
                aria-label={`Use image: ${c.label || 'unlabeled candidate'}`}
                title={c.label || ''}
                className={`bg-neutral-800 rounded overflow-hidden ring-1 ring-transparent hover:ring-oak transition-all disabled:opacity-40 disabled:cursor-wait ${cfg.kind === 'author' ? 'aspect-square' : 'aspect-[2/3]'}`}
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
        className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-400 hover:text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
      >
        <span>Skip</span>
        <span className="text-[10px] text-neutral-600">S</span>
      </button>
    </div>
  );
}
