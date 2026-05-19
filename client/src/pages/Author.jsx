import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { api } from '../api.js';
import { plural, initialsFor, MOD_KEY } from '../utils.js';
import BookCard from '../components/BookCard.jsx';

// Inline gender picker. Stores 'male' | 'female' | 'other' | null;
// empty string in the select maps back to null so the user can clear
// the field. Styled to blend into the surrounding meta line — native
// chevron suppressed, padding stripped, underline-on-hover signals
// it's interactive without screaming "form control".
// Native <select> sizes itself to its widest option ("unassigned" here),
// which leaves an awkward gap to the right of shorter values. Workaround:
// render a span that auto-sizes to the current value and overlay a
// transparent <select> on top to keep the native dropdown's keyboard
// support and accessibility. Hover/focus styles cascade via `group`.
function GenderPicker({ value, onChange }) {
  const display = value ?? 'unassigned';
  return (
    <span className="relative inline-block group cursor-pointer">
      <span className="text-sm text-neutral-700 group-hover:text-neutral-400 group-hover:underline group-focus-within:text-neutral-400 group-focus-within:underline transition-colors">
        {display}
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer focus:outline-none"
        aria-label="Author gender"
      >
        <option value="">unassigned</option>
        <option value="male">male</option>
        <option value="female">female</option>
        <option value="other">other</option>
      </select>
    </span>
  );
}

// Render a stored date string ("1938" / "1938-07-18" / "-428") as a
// human-readable label. BCE years drop the leading "-" and append BCE.
// Year-only stays bare. Full dates render as "July 18, 1938".
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function formatDate(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return String(dateStr);
  const year  = parseInt(m[1], 10);
  const month = m[2] ? parseInt(m[2], 10) : null;
  const day   = m[3] ? parseInt(m[3], 10) : null;
  const yearLabel = year < 0 ? `${-year} BCE` : String(year);
  if (!month) return yearLabel;
  const monthLabel = MONTH_LABELS[month - 1] ?? '';
  if (!day) return `${monthLabel} ${yearLabel}`;
  return `${monthLabel} ${day}, ${yearLabel}`;
}

// "Jul 18, 1938 – 2007" / "1938 –" (living author) / "– 2007" / null.
function lifespan(birth, death) {
  const b = formatDate(birth);
  const d = formatDate(death);
  if (!b && !d) return null;
  if (b && d)   return `${b} – ${d}`;
  if (b)        return `${b} –`;
  return `– ${d}`;
}

// Mirrors the server's parseDateField regex — used to flag malformed
// input before we hit the API.
const DATE_INPUT_RE = /^-?\d{1,4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;

// Auto-insert dashes as the user types digits, so "19380718" becomes
// "1938-07-18" on the fly. Strips any non-digit characters and re-
// formats based on digit count: ≤4 → YYYY, 5-6 → YYYY-MM, 7+ → YYYY-MM-DD.
// BCE years (leading '-') are passed through untouched — the digit
// count is ambiguous when a sign and explicit separator are in play,
// so user types those manually.
function autoFormatDate(raw) {
  if (!raw) return '';
  if (raw.startsWith('-')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4);
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
}

// Inline editor for birth/death date. Default state shows the formatted
// dates (or a dim "add dates" hint if both null) as a hover-revealed
// link; clicking swaps in two text inputs that accept YYYY, YYYY-MM,
// or YYYY-MM-DD (BCE: "-428"). Enter commits, Esc cancels. Same hover-
// reveal aesthetic as GenderPicker so the dates feel like ambient
// metadata rather than a form control.
function DatesPicker({ birth, death, onChange }) {
  const [editing, setEditing] = useState(false);
  const [birthDraft, setBirthDraft] = useState('');
  const [deathDraft, setDeathDraft] = useState('');
  const [error, setError] = useState(null);
  function start() {
    setBirthDraft(birth ?? '');
    setDeathDraft(death ?? '');
    setError(null);
    setEditing(true);
  }
  function commit() {
    setError(null);
    const b = birthDraft.trim();
    const d = deathDraft.trim();
    if (b !== '' && !DATE_INPUT_RE.test(b)) return setError('Use YYYY, YYYY-MM, or YYYY-MM-DD');
    if (d !== '' && !DATE_INPUT_RE.test(d)) return setError('Use YYYY, YYYY-MM, or YYYY-MM-DD');
    onChange({
      birth_date: b === '' ? null : b,
      death_date: d === '' ? null : d,
    });
    setEditing(false);
  }
  function cancel() { setEditing(false); setError(null); }
  function onKey(e) {
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
  }
  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <input
          type="text" value={birthDraft} onChange={(e) => setBirthDraft(autoFormatDate(e.target.value))}
          onKeyDown={onKey} autoFocus aria-label="Birth date"
          placeholder="1938-07-18"
          className="w-28 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-sm text-neutral-200 placeholder-neutral-700 focus:outline-none focus:border-oak/50"
        />
        <span className="text-neutral-700">–</span>
        <input
          type="text" value={deathDraft} onChange={(e) => setDeathDraft(autoFormatDate(e.target.value))}
          onKeyDown={onKey} aria-label="Death date"
          placeholder="2007"
          className="w-28 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-sm text-neutral-200 placeholder-neutral-700 focus:outline-none focus:border-oak/50"
        />
        <button onClick={commit} className="text-xs text-oak hover:text-leather transition-colors">Save</button>
        <button onClick={cancel}  className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">Cancel</button>
        {error && <span role="alert" className="text-xs text-warn ml-1">{error}</span>}
      </span>
    );
  }
  const text = lifespan(birth, death);
  return (
    <button
      onClick={start}
      className="text-sm text-neutral-700 hover:text-neutral-400 hover:underline focus:text-neutral-400 focus:underline focus:outline-none transition-colors"
    >
      {text ?? 'add dates'}
    </button>
  );
}

// Author entity page: lists all books bylined under this specific
// author plus an "also writes as" section linking to alias siblings.
// Distinct from /browse/author/:name which is a name-based filter view —
// the entity page is id-based (stable across renames) and surfaces the
// aliases that the filter view can't.
export default function Author() {
  const { id }       = useParams();
  const { state, pathname } = useLocation();
  const backLabel    = state?.from ? `← ${state.from}` : '← Library';
  const backPath     = state?.fromPath ?? '/';

  const [author, setAuthor] = useState(null);
  const [loading, setLoading] = useState(true);
  // 'notfound' for a 404 (author id has no row), 'fetch' for any other
  // failure. Distinguished so the body can show a tailored message
  // instead of conflating "this author doesn't exist" with "the request
  // failed — please retry".
  const [errorKind, setErrorKind] = useState(null);
  const [sort, setSort] = useState('year_published');
  const [bioExpanded, setBioExpanded] = useState(false);
  const [bioEditing, setBioEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [bioSaving, setBioSaving] = useState(false);
  const [bioError, setBioError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorKind(null);
    api.getAuthor(id, { sort })
      .then(data => { if (!cancelled) setAuthor(data); })
      .catch(err => {
        if (cancelled) return;
        setErrorKind(err?.status === 404 ? 'notfound' : 'fetch');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, sort]);

  // Reset bio collapse + edit state when navigating to a different
  // author — otherwise we'd carry the previous author's expanded state
  // into a new visit.
  useEffect(() => { setBioExpanded(false); setBioEditing(false); setBioError(null); }, [id]);

  function startBioEdit() {
    setBioDraft(author?.bio ?? '');
    setBioError(null);
    setBioEditing(true);
  }

  async function saveBio() {
    if (bioSaving) return;
    setBioSaving(true);
    setBioError(null);
    try {
      const updated = await api.updateAuthor(author.id, { bio: bioDraft });
      setAuthor(a => a ? { ...a, ...updated } : a);
      setBioEditing(false);
    } catch {
      setBioError('Failed to save bio.');
    } finally {
      setBioSaving(false);
    }
  }

  async function handleManualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const updated = await api.refreshAuthor(author.id);
      setAuthor(a => a ? { ...a, ...updated } : a);
    } catch {
      // No-op; the prior cached state stays visible. A future iteration
      // could surface a small inline error here.
    } finally {
      setRefreshing(false);
    }
  }

  async function uploadPhoto(file) {
    if (photoBusy || !author || !file) return;
    if (!file.type?.startsWith('image/')) {
      setPhotoError('That doesn’t look like an image.');
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const updated = await api.uploadAuthorPhoto(author.id, file);
      setAuthor(a => a ? { ...a, ...updated } : a);
    } catch {
      setPhotoError('Failed to upload portrait.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (photoBusy || !author) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const updated = await api.deleteAuthorPhoto(author.id);
      setAuthor(a => a ? { ...a, ...updated } : a);
    } catch {
      setPhotoError('Failed to remove portrait.');
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file in a row
    if (file) uploadPhoto(file);
  }

  // Paste-to-upload: while on the Author page, a clipboard image (Cmd/
  // Ctrl-V on a screenshot or copied portrait) lands directly on this
  // author. Listens on document so the user doesn't have to click a
  // specific element first — paste anywhere on the page works.
  useEffect(() => {
    if (!author) return;
    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); uploadPhoto(file); return; }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [author]);

  const fromState = useMemo(
    () => ({ from: author?.name, fromPath: pathname }),
    [author?.name, pathname],
  );


  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/*
        Back: navigate directly to state.fromPath so the click destination
        matches the label. Pass no `state` so the destination renders
        fresh — otherwise we'd clobber its existing state with the current
        page's (the alias-loop A → B → A trap). Necessary for the R-chain:
        chain-preservation freezes the label at the original referrer
        through many random hops, and navigate(-1) would walk one step at
        a time, sending the user to the previous random author instead of
        where the label promises.
      */}
      <Link to={backPath} className="text-sm text-neutral-500 hover:text-neutral-200 transition-colors">
        {backLabel}
      </Link>

      <div className="mt-6 mb-8 flex flex-col sm:flex-row gap-6">
        {/* Portrait. Skeleton-style placeholder when no photo (OL miss
            or fetch failed) so the page still feels first-class.
            Clicking the portrait opens the file picker; pasting a
            clipboard image anywhere on the page also uploads to this
            author (paste handler is on document). */}
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={() => !photoBusy && fileInputRef.current?.click()}
            disabled={photoBusy || !author}
            className="group relative block w-32 h-40 sm:w-36 sm:h-44 rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-oak/50 disabled:cursor-wait"
            aria-label="Change portrait"
            title="Click to upload — or paste an image"
          >
            {author?.photo_path ? (
              <img
                src={author.photo_path}
                alt={author.name ? `Portrait of ${author.name}` : ''}
                className="w-full h-full object-cover bg-neutral-800"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center text-neutral-700 text-3xl font-slab tracking-wide">
                {initialsFor(author?.name)}
              </div>
            )}
            <span className="absolute inset-0 bg-black/0 group-hover:bg-black/40 group-focus:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus:opacity-100 text-white text-xs font-medium">
              {photoBusy ? 'Uploading…' : (author?.photo_path ? 'Change portrait' : 'Upload portrait')}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />
          {author?.photo_path && (
            <button
              type="button"
              onClick={removePhoto}
              disabled={photoBusy}
              className="block mt-1.5 text-[11px] text-neutral-700 hover:text-warn transition-colors disabled:opacity-50"
            >
              Remove portrait
            </button>
          )}
          {photoError && <p role="alert" className="mt-1.5 text-[11px] text-warn">{photoError}</p>}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Author</p>
          <h1 className="text-2xl font-bold text-white">{author?.name ?? (loading || errorKind === 'fetch' ? ' ' : 'Author not found')}</h1>
          {author?.aliases?.length > 0 && (
            <p className="text-neutral-600 text-xs mt-1">
              also writes as{' '}
              {author.aliases.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && (i === author.aliases.length - 1 ? ' & ' : ', ')}
                  <Link to={`/authors/${a.id}`} state={fromState} className="hover:text-neutral-400 transition-colors">
                    {a.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {!loading && author && (
            <p className="text-sm text-neutral-500 mt-1 flex items-center gap-2 flex-wrap">
              <span>{plural(author.total, 'book')}</span>
              <span className="text-neutral-700">·</span>
              <GenderPicker
                value={author.gender}
                onChange={async (next) => {
                  const prev = author.gender;
                  setAuthor(a => ({ ...a, gender: next }));
                  try {
                    await api.updateAuthor(author.id, { gender: next });
                  } catch {
                    setAuthor(a => ({ ...a, gender: prev }));
                  }
                }}
              />
              <span className="text-neutral-700">·</span>
              <DatesPicker
                birth={author.birth_date}
                death={author.death_date}
                onChange={async (next) => {
                  const prev = { birth_date: author.birth_date, death_date: author.death_date };
                  setAuthor(a => ({ ...a, ...next }));
                  try {
                    await api.updateAuthor(author.id, next);
                  } catch {
                    setAuthor(a => ({ ...a, ...prev }));
                  }
                }}
              />
            </p>
          )}
          {!loading && author && (
            <div className="mt-3 group">
              {bioEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setBioEditing(false); setBioError(null); }
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveBio(); }
                    }}
                    autoFocus
                    rows={6}
                    placeholder="Author bio…"
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-oak/50"
                    aria-label="Author bio"
                  />
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      onClick={saveBio}
                      disabled={bioSaving}
                      className="text-oak hover:text-leather transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {bioSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setBioEditing(false); setBioError(null); }}
                      disabled={bioSaving}
                      className="text-neutral-600 hover:text-neutral-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <span className="text-neutral-700">{MOD_KEY}+↵ to save · Esc to cancel</span>
                    {bioError && <span role="alert" className="text-warn ml-auto">{bioError}</span>}
                  </div>
                </div>
              ) : author.bio ? (
                <>
                  <p className={`text-sm text-neutral-400 whitespace-pre-line ${bioExpanded ? '' : 'line-clamp-4'}`}>
                    {author.bio}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    {/* "Show more" only when the rendered text overflows
                        the 4-line clamp. We approximate "long" by char
                        count to avoid a brittle DOM-measurement pass —
                        bios over ~280 chars almost always need the
                        toggle. */}
                    {author.bio.length > 280 && (
                      <button
                        onClick={() => setBioExpanded(b => !b)}
                        className="text-oak hover:text-leather transition-colors"
                      >
                        {bioExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                    <button
                      onClick={startBioEdit}
                      className="text-neutral-700 hover:text-neutral-400 transition-colors opacity-60 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      ✎ Edit bio
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={startBioEdit}
                  className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
                >
                  + Add bio
                </button>
              )}
            </div>
          )}
          {!loading && author && (
            <button
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="text-[11px] text-neutral-700 hover:text-neutral-400 mt-3 transition-colors disabled:opacity-50 disabled:cursor-wait"
              title="Re-fetch bio + portrait from Open Library"
            >
              {refreshing ? '↻ Refreshing…' : '↻ Refresh from Open Library'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : errorKind === 'fetch' ? (
        <div className="text-center py-32">
          <p className="text-neutral-600">Failed to load author. Please try again.</p>
        </div>
      ) : errorKind === 'notfound' ? null
      : !author?.books?.length ? (
        <div className="text-neutral-600 text-sm">No books found.</div>
      ) : (
        <>
          <div className="mb-4">
            <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
              <span>Sort:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 cursor-pointer transition-colors"
                aria-label="Sort author's books"
              >
                <option value="year_published">Chronological</option>
                <option value="year_published_desc">Reverse chronological</option>
                <option value="title">Title</option>
                <option value="rating">Rating</option>
                <option value="added">Recently added</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5 items-start">
            {author.books.map(book => <BookCard key={book.id} book={book} linkState={fromState} />)}
          </div>
        </>
      )}
    </div>
  );
}
