import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom';

// Renders when a route throws or returns a non-2xx response — replaces
// the default react-router "Unexpected Application Error!" stack-dump
// screen. Two modes:
//   - Dev (import.meta.env.DEV): full stack trace + the message, so the
//     error is still as discoverable as the default screen used to be.
//   - Prod: a calm "Something went wrong on this page" with a back-to-
//     library link. The user doesn't need the stack, just a way out.
// Route 404s (path="*" in main.jsx) bypass this and render <NotFound/>
// directly, so this boundary is exclusively for exceptions.
export default function RouteError() {
  const err  = useRouteError();
  const isHttp = isRouteErrorResponse(err);
  const title  = isHttp ? `${err.status} ${err.statusText}` : 'Something went wrong on this page.';
  const detail = isHttp ? err.data : (err?.message || String(err));
  const stack  = !isHttp ? err?.stack : null;

  return (
    <div className="max-w-3xl py-6">
      <h1 className="text-xl text-neutral-300 mb-2">{title}</h1>
      <p className="text-sm text-neutral-500 mb-6">
        If reloading doesn't help, head back to the library and try a different path.
      </p>
      <div className="flex items-center gap-4 text-sm">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          ↻ Reload
        </button>
        <Link to="/" className="text-neutral-400 hover:text-neutral-200 transition-colors">
          ← Back to Library
        </Link>
      </div>
      {import.meta.env.DEV && (
        <details open className="mt-10 text-xs text-neutral-600">
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
            Developer details
          </summary>
          <p className="mt-3 text-warn">{detail}</p>
          {stack && (
            <pre className="mt-3 overflow-auto bg-neutral-900/60 border border-neutral-800 rounded p-3 whitespace-pre-wrap leading-relaxed">
              {stack}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}
