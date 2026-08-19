// Shared Library view vocabulary — the sort catalogue and the set of
// valid tab keys. Consumed by both pages/Library.jsx (the dropdown +
// per-tab sort memory) and components/CommandPalette.jsx (the
// "Sort by …" command entries). These were hand-mirrored across the two
// files and silently drifted — the palette was missing the 'acquired'
// and 'duration' sorts Library had gained. Keeping the single copy here
// is the fix: the sort keys are part of the URL contract anyway, so a
// shared leaf module couples neither file to the other's internals.

export const SORTS = [
  { key: 'updated',     label: 'Recently updated' },
  { key: 'last_logged', label: 'Recently logged' },
  { key: 'added',       label: 'Recently added' },
  { key: 'acquired',    label: 'Recently acquired' },
  { key: 'author',      label: 'Author A–Z' },
  { key: 'title',       label: 'Title A–Z' },
  { key: 'rating',      label: 'Rating' },
  { key: 'progress',    label: 'Progress' },
  { key: 'started',     label: 'Date started' },
  { key: 'finished',    label: 'Date finished' },
  { key: 'length',      label: 'Length' },
  // Duration is only meaningful when audiobooks can appear in the
  // listing — Library gates it in the dropdown render against
  // filters.formats (see the requiresAudiobook filter there). The
  // command palette exposes it unconditionally: the sort still works
  // server-side regardless of format filter, it just sorts non-audio
  // formats as 0 minutes at the bottom.
  { key: 'duration',    label: 'Duration', requiresAudiobook: true },
  { key: 'random',      label: 'Random' },
];

export const VALID_TABS = new Set([
  'reading', 'finished', 'unread', 'owned',
  'prev_owned', 'never_owned', 'all', 'archived',
]);
