// Dismissible inline error banner. Used for non-fatal errors (refresh-tick
// failures, save-rollback failures, reorder failures) where the page still
// has a usable view and the error should sit above the content rather than
// replace it. Stats / Diary / ShelfView / ShelfManager / Loved / BrowsePage
// all surfaced this same shape inline before; pulling it out keeps the
// styling (border, color, dismiss button) consistent across surfaces.
//
// Returns null when `message` is falsy, so the common `{error && <ErrorBanner …/>}`
// guard can usually be dropped. Compound conditions (e.g. only show when
// there's also data to wrap) still belong at the call site.
export default function ErrorBanner({ message, onDismiss, className = '' }) {
  if (!message) return null;
  return (
    <div className={`flex items-center justify-between bg-warn/10 border border-warn/30 rounded px-3 py-2 ${className}`}>
      <p role="alert" className="text-xs text-warn">{message}</p>
      <button onClick={onDismiss} title="Dismiss" aria-label="Dismiss" className="text-xs text-warn/60 hover:text-warn ml-4">×</button>
    </div>
  );
}
