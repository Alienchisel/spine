import { Link, useLocation } from 'react-router-dom';

// Conditional back link for pages reached via a state-carrying referrer
// (Stats → Library / Loved / AuthorsIndex / TagsIndex / SeriesIndex, etc).
// Renders '← {state.from}' linking to state.fromPath when set, else
// nothing — cold deep-links and Nav clicks stay clean.
export default function IncomingBackLink() {
  const { state } = useLocation();
  if (!state?.from) return null;
  return (
    <Link
      to={state.fromPath ?? '/'}
      className="text-sm text-neutral-600 hover:text-neutral-300 mb-4 inline-block transition-colors"
    >
      ← {state.from}
    </Link>
  );
}
