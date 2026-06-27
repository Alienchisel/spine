// Quiet skeleton placeholders for cover-first surfaces. Renders during
// the initial load window only — refetches keep the prior cards on
// screen, so layering skeletons during a refresh would be a visible
// regression. Used by Library, BrowsePage, Author, BookDetail.
//
// Pulse is gated to `motion-safe:` so a user with prefers-reduced-motion
// sees a static placeholder instead of a breathing one. The bg-* tone
// matches BookCard's "no cover yet" fallback so the placeholder reads as
// "an image is coming here" rather than as an empty box.

// Single cover-aspect placeholder. `compact` matches the BookCard prop —
// smaller covers in dense modes drop the rounded corner and shadow.
export function CoverSkeleton({ compact = false }) {
  return (
    <div
      aria-hidden="true"
      className={`bg-neutral-800/60 motion-safe:animate-pulse aspect-[2/3] ${
        compact ? 'rounded-sm' : 'rounded shadow-lg'
      }`}
    />
  );
}

// Grid of cover skeletons. Pass through the same `gridStyle` /
// `gridClassName` the real grid uses (Library + BrowsePage get these
// from useCoverSize so the column count exactly matches what the real
// books will land into — no layout shift on data arrival). Author has
// its own hardcoded grid; pass that in via `gridClassName` and leave
// `gridStyle` undefined.
//
// `count` should approximate first-page-worth of books at typical
// viewport so the screen feels populated. A small count (6) for sparse
// surfaces like Author's per-author book grid; a larger one (20) for
// the main Library.
export function GridSkeleton({
  count = 12,
  compact = false,
  gridStyle,
  gridClassName = 'grid items-start gap-x-3 gap-y-5 grid-cols-3 sm:grid-cols-4 md:grid-cols-5',
}) {
  return (
    <div
      role="status"
      aria-label="Loading books"
      className={gridClassName}
      style={gridStyle}
    >
      {Array.from({ length: count }, (_, i) => (
        <CoverSkeleton key={i} compact={compact} />
      ))}
    </div>
  );
}

// Stats page skeleton — placeholder for the heading, hero number row,
// and a few section blocks above the fold. Real renders below the fold
// don't need skeleton mass; by the time the user scrolls past the hero
// row the fetch has resolved. Used on cache-miss (first visit /
// post-mutation revisit) to anchor expectations during the load window.
export function StatsSkeleton() {
  return (
    <div role="status" aria-label="Loading stats" className="space-y-10">
      <div className="bg-neutral-800/60 motion-safe:animate-pulse h-9 w-24 rounded" />
      {/* Hero row: five big-number tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-6 sm:gap-8 py-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="text-center sm:text-left space-y-2">
            <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-20 rounded" />
            <div className="bg-neutral-800/60 motion-safe:animate-pulse h-10 w-24 rounded" />
          </div>
        ))}
      </div>
      {/* Section blocks — section title + a row of card placeholders */}
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="space-y-3">
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-32 rounded" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="bg-neutral-800/60 motion-safe:animate-pulse h-20 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Audit page skeleton — two-column shape mirroring the real Audit:
// hero score + portrait on the left, grouped audit-row list on the
// right. Used on cache-miss to anchor structure while the heavier
// audit scan runs.
export function AuditSkeleton() {
  return (
    <div role="status" aria-label="Loading audit" className="max-w-5xl mx-auto space-y-8">
      <div className="bg-neutral-800/60 motion-safe:animate-pulse h-9 w-40 rounded" />
      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-10">
        {/* Hero — score, caption, portrait placeholder */}
        <div className="space-y-4">
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-24 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-20 w-48 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-56 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse aspect-[2/3] rounded-sm" />
        </div>
        {/* Audit list — group headings each followed by a few rows */}
        <div className="space-y-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-32 rounded" />
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="bg-neutral-800/60 motion-safe:animate-pulse h-7 rounded" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// DataViz page skeleton — page heading + four placeholder experiment
// blocks (description line + content area). Used on cache-miss while
// the six-endpoint Promise.all fetch resolves.
export function DataVizSkeleton() {
  return (
    <div role="status" aria-label="Loading data viz" className="max-w-5xl mx-auto space-y-12">
      <div className="bg-neutral-800/60 motion-safe:animate-pulse h-9 w-56 rounded" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-4">
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-4 w-3/4 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-48 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ShelfView skeleton — mirrors the entry view (Shelves crumb + cover-size
// slider + grid of LevelCard tiles for buildings). Subsequent drill-down
// states (Building → Room → Unit) share the same broad shape (grid of
// LevelCards) so this works as a generic placeholder. The 6-tile count
// matches a typical small-library footprint without dwarfing it on a
// minimal one.
export function ShelfViewSkeleton() {
  return (
    <div role="status" aria-label="Loading shelves">
      {/* Crumb + cover-slider header strip */}
      <div className="flex items-center justify-between mb-6">
        <div className="bg-neutral-800/60 motion-safe:animate-pulse h-4 w-20 rounded" />
        <div className="flex items-center gap-4">
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-24 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-28 rounded" />
        </div>
      </div>
      {/* LevelCard grid — matches the entry view's
          grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 shape with two-line
          tiles (primary label + secondary caption) to mirror real cards. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-2"
          >
            <div className="bg-neutral-800/60 motion-safe:animate-pulse h-4 w-2/3 rounded" />
            <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// BookDetail's hero + cover-rail skeleton. Mirrors the page's actual
// layout — cover-rail on the left (280×420), hero band + center column
// on the right with title-bar / byline / meta-cluster placeholders —
// so the page's structure is anchored before the data lands.
export function BookDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading book" className="max-w-7xl">
      <div className="bg-neutral-800/60 motion-safe:animate-pulse h-4 w-20 rounded mb-8" />
      <div className="bg-neutral-800/60 motion-safe:animate-pulse h-9 w-3/4 rounded mb-2" />
      <div className="bg-neutral-800/60 motion-safe:animate-pulse h-4 w-1/3 rounded mb-6" />
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
        <div className="flex-shrink-0 self-center lg:self-start">
          <div className="bg-neutral-800/60 motion-safe:animate-pulse w-[280px] h-[420px] rounded shadow-2xl" />
        </div>
        <div className="flex-1 min-w-0 space-y-3 pt-1">
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-2/3 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-1/2 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-3/5 rounded" />
          <div className="bg-neutral-800/60 motion-safe:animate-pulse h-3 w-2/5 rounded" />
        </div>
      </div>
    </div>
  );
}
