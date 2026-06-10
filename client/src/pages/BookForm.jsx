import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link, useBlocker } from 'react-router-dom';
import { api } from '../api.js';
import { FORM_DEFAULTS, VIRTUAL_TAG_NAMES } from '../../../shared/bookFields.js';
import { bookToFormState, formStateToPayload } from '../components/bookForm/mapping.js';
import { input, inputFilled } from '../components/bookForm/styles.js';
import LookupPanel from '../components/bookForm/LookupPanel.jsx';
import CoverPicker from '../components/bookForm/CoverPicker.jsx';
import CoreFields from '../components/bookForm/CoreFields.jsx';
import DetailsFields from '../components/bookForm/DetailsFields.jsx';
import AcquisitionFields from '../components/bookForm/AcquisitionFields.jsx';
import PersonalFields from '../components/bookForm/PersonalFields.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import PageHeading from '../components/PageHeading.jsx';

const TABS = [
  { key: 'core',        label: 'Core' },
  { key: 'details',     label: 'Details' },
  { key: 'acquisition', label: 'My copy' },
  { key: 'personal',    label: 'Personal' },
];

// Server-side validation echoes the offending field name; we route the
// banner-augmentation + tab-switch off this map. Fields not listed here
// (e.g. nested join-table fields) fall through to a plain banner without
// tab-switching. Keep in sync with the field sections' contents — if a
// field moves tabs, update the value here.
const FIELD_TO_TAB = {
  title:            'core',
  status:           'core',
  format:           'core',
  binding:          'core',
  condition:        'core',
  source_type:      'core',
  fiction:          'core',
  page_count:       'core',
  duration_minutes: 'core',
  date_started:     'core',
  date_finished:    'core',
  series_number:    'core',
  read_count:       'core',
  year_published:   'details',
  year_edition:     'details',
  isbn:             'details',
  isbn_10:          'details',
  isbn_13:          'details',
  asin:             'details',
  acquisition_date: 'acquisition',
  rating:           'personal',
};

export default function BookForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state: navState } = useLocation();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(FORM_DEFAULTS);
  const [activeTab, setActiveTab] = useState('core');
  const [tagInput,        setTagInput]        = useState('');
  const [narratorInput,   setNarratorInput]   = useState('');
  const [authorInput,     setAuthorInput]     = useState('');
  const [translatorInput, setTranslatorInput] = useState('');
  const [coverPreview, setCoverPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [coverError, setCoverError] = useState(null);
  const [fetchingCover, setFetchingCover] = useState(false);
  const saveGuard = useActionGuard();
  const [error, setError] = useState(null);
  // Setup-load warnings split per fetch so a later success of one doesn't
  // mask an earlier failure of the other. `error` above stays scoped to
  // form-save failures.
  const [shelfTreeError, setShelfTreeError] = useState(null);
  const [suggestionsError, setSuggestionsError] = useState(null);
  // If the edit-fetch fails, the form stays at FORM_DEFAULTS — looks
  // exactly like a fresh "Add Book" form. Saving from that state would
  // PUT defaults over the real book and wipe its relations (syncAuthors([]),
  // syncTags([]), etc.). loadError gates submit so that can't happen.
  const [loadError, setLoadError] = useState(null);
  const [pastSources, setPastSources] = useState([]);
  const [pastAuthors, setPastAuthors] = useState([]);
  const [pastPublishers, setPastPublishers] = useState([]);
  const [pastSeries, setPastSeries] = useState([]);
  const [pastTranslators, setPastTranslators] = useState([]);
  const [pastNarrators, setPastNarrators] = useState([]);
  const [pastLanguages, setPastLanguages] = useState([]);
  const [pastTags, setPastTags] = useState([]);
  const [shelfTree, setShelfTree] = useState([]);
  const [filledByLookup, setFilledByLookup] = useState(new Set());
  // Stale-response guard for the edit-mode getBook fetch. Quick navigation
  // between two edit pages could otherwise let an older response clobber
  // the form populated for a newer book id.
  const editGuard = useStaleGuard();
  // True while the edit-mode getBook fetch is in flight. Disables submit
  // so a user clicking Save during the gap can't PUT the previous book's
  // form data to the new id. Distinct from saveGuard.busy (the actual
  // save in progress) and `loadError` (set only on failure).
  const [loadingBook, setLoadingBook] = useState(false);
  // Stale-result guard for applyResult. Picking lookup result A, then
  // quickly picking B, used to let A's slower description/cover awaits
  // resolve after B's and overwrite B's form fields and cover state.
  const lookupApplyGuard = useStaleGuard();
  // Stale-result guard for any cover-affecting action — fetchCoverFromIsbn,
  // uploadFile, the paste/drag fetchAndSetCover, AND applyResult's cover
  // branch. Shared across all four so any combo (paste-then-upload,
  // ISBN-then-pick, etc.) drops the slower one's writes and finally.
  const coverActionGuard = useStaleGuard();
  const shelfTreeGuard   = useStaleGuard();
  const suggestionsGuard = useStaleGuard();
  // Synchronous in-flight lock shared by every cover-mutating action
  // above. The genRef handles late-resolution races (latest writer wins),
  // but doesn't dedupe in-flight calls — two same-tick clicks on the
  // ISBN fetch button, or a click on Upload File while a fetch is
  // already running, both pass the React state checks and both POST.
  // The fetch endpoint hits an external cover provider and writes the
  // file; one shared ref closes the whole family of duplicates without
  // needing four parallel locks. Mirrors Library.pagingRef's shared-
  // boolean pattern.
  const coverActionRef = useRef(false);
  const tabRefs = useRef([]);

  function handleTabKey(e, idx) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = (idx + dir + TABS.length) % TABS.length;
      setActiveTab(TABS[next].key);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab(TABS[0].key);
      tabRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveTab(TABS[TABS.length - 1].key);
      tabRefs.current[TABS.length - 1]?.focus();
    }
  }
  const [durationH, setDurationH] = useState('');
  const [durationM, setDurationM] = useState('');
  // Tracks whether the form has unsaved user edits since mount or last
  // successful save. Drives two guards below (browser-back / SPA-nav and
  // beforeunload). Edit-load and FORM_DEFAULTS reset don't go through the
  // wrapped setters, so loading a book doesn't taint dirty.
  const [dirty, setDirty] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    const epoch = shelfTreeGuard.next();
    setShelfTreeError(null);
    api.getShelfTree()
      .then(t => { if (shelfTreeGuard.isFresh(epoch)) setShelfTree(t); })
      .catch(() => { if (shelfTreeGuard.isFresh(epoch)) setShelfTreeError('Failed to load shelves — the shelf picker may be empty.'); });
  }, []);

  useEffect(() => {
    const epoch = suggestionsGuard.next();
    setSuggestionsError(null);
    api.getBookFacets().then(f => {
      if (!suggestionsGuard.isFresh(epoch)) return;
      setPastSources(f.sources || []);
      setPastAuthors(f.authors || []);
      setPastPublishers(f.publishers || []);
      setPastSeries(f.series || []);
      setPastTranslators(f.translators || []);
      setPastNarrators(f.narrators || []);
      setPastLanguages(f.languages || []);
      setPastTags(f.tags?.filter(t => !VIRTUAL_TAG_NAMES.includes(t)) || []);
    }).catch(() => { if (suggestionsGuard.isFresh(epoch)) setSuggestionsError('Failed to load suggestions — autocomplete lists may be empty.'); });
  }, []);

  useEffect(() => {
    if (!isEdit) {
      // Transitioning from edit-of-X to a non-edit context (e.g. /books/new):
      // bump the gen so any in-flight getBook(X) drops its setForm on
      // resolve, and clear loadingBook so the submit button isn't gated
      // forever. Without these, the new-book form could end up populated
      // with X's data, AND the submit button stays disabled latently.
      // Also wipe form/cover/duration/filledByLookup — React Router 6
      // reuses the BookForm instance across /books/:id/edit ↔ /books/new
      // (same element type at the same route depth), so without an
      // explicit reset here, edit-X data would carry over into the
      // "Add book" form. The wipes are no-ops on initial /books/new
      // mounts where the state is already at defaults.
      editGuard.next();
      setLoadingBook(false);
      setLoadError(null);
      setForm(FORM_DEFAULTS);
      setDurationH('');
      setDurationM('');
      setCoverPreview(null);
      setCoverError(null);
      setFilledByLookup(new Set());
      setDirty(false);
      return;
    }
    const epoch = editGuard.next();
    // Reset all form state tied to the previous id so the form doesn't
    // briefly show A's fields under B's URL during the in-flight gap.
    // Combined with loadingBook → disabled submit, this also closes the
    // data-loss path where a quick Save during the gap would PUT A's
    // form data to B's id.
    setLoadError(null);
    setLoadingBook(true);
    setForm(FORM_DEFAULTS);
    setDurationH('');
    setDurationM('');
    setCoverPreview(null);
    setCoverError(null);
    setFilledByLookup(new Set());
    api.getBook(id).then((book) => {
      if (!editGuard.isFresh(epoch)) return;
      setForm(bookToFormState(book));
      if (book.duration_minutes) {
        setDurationH(String(Math.floor(book.duration_minutes / 60)));
        setDurationM(String(book.duration_minutes % 60));
      }
      if (book.cover_path) setCoverPreview(book.cover_path);
    })
      .catch(() => { if (editGuard.isFresh(epoch)) setLoadError('Failed to load book.'); })
      .finally(() => { if (editGuard.isFresh(epoch)) setLoadingBook(false); });
  }, [id, isEdit]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFilledByLookup(s => { if (!s.has(field)) return s; const n = new Set(s); n.delete(field); return n; });
    setDirty(true);
  }

  // Wrapped duration setters passed to children. Auxiliary state that
  // doesn't flow through `set()` directly but still represents a user
  // edit, so back-out without saving should be guarded.
  const onDurationH = (v) => { setDurationH(v); setDirty(true); };
  const onDurationM = (v) => { setDurationM(v); setDirty(true); };
  // Wrapped setForm passed to children that need multi-field updates the
  // single-field set() can't express (format select with its
  // dependent-field clearing, owned/is_custom checkboxes that cascade,
  // shelf-location cascade). Without dirty-tracking on these, the user
  // could change format → audiobook, back out, and lose the edit
  // silently — guard inactive for that path.
  const setFormDirty = (updater) => { setForm(updater); setDirty(true); };

  // Guard 1: SPA navigation — clicking ← Library, the breadcrumb, or any
  // in-app navigation while there are unsaved edits. The cover-orphan
  // path is the load-bearing case: a drag-uploaded cover writes a file
  // to /uploads/ immediately but only attaches to a book on Save. Backing
  // out mid-edit silently leaks the file and discards other field edits.
  // Requires the data router defined in main.jsx (useBlocker only works
  // under createBrowserRouter / RouterProvider, not <BrowserRouter>).
  // Gate on saveGuard.isBusy(): handleSubmit does `setDirty(false);
  // navigate(...)` in the same tick, but state updates are batched —
  // when navigate fires the blocker callback's closure still sees
  // dirty=true and the discard prompt would fire on a *successful* save.
  // begin() mutates the sync ref before the await, so isBusy() reads true
  // when the blocker callback evaluates and bypasses cleanly. Cleared on
  // failure so a stuck-saving state can't permanently disable the guard.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !saveGuard.isBusy() && currentLocation.pathname !== nextLocation.pathname
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    confirm({
      message: form.title?.trim()
        ? `Discard unsaved changes to "${form.title.trim()}"?`
        : 'Discard unsaved changes?',
      confirmLabel: 'Discard',
    }).then(ok => {
      if (cancelled) return;
      if (ok) blocker.proceed();
      else blocker.reset();
    });
    return () => { cancelled = true; };
  }, [blocker, confirm]);

  // Guard 2: hard browser navigation — close tab, refresh, address-bar
  // URL change. beforeunload doesn't fire for SPA route changes, hence
  // the useBlocker above. Browser shows its generic "Changes you made
  // may not be saved" dialog; the message isn't customizable.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Revoke the blob: URL when coverPreview is replaced or the form unmounts.
  // Server paths and fetched URLs flow through coverPreview too, so the prefix
  // guard prevents revoking non-blob values that the browser would no-op anyway
  // but reads as a category error to a future reader.
  useEffect(() => {
    return () => {
      if (coverPreview && coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  async function applyResult(result) {
    const lookupEpoch = lookupApplyGuard.next();
    const { description } = result.key ? await api.fetchBookDescription(result.key).catch(() => ({ description: null })) : { description: null };
    if (!lookupApplyGuard.isFresh(lookupEpoch)) return;
    const filled = new Set();
    if (result.title)           filled.add('title');
    if (result.authors?.length) filled.add('authors');
    if (result.publisher)       filled.add('publisher');
    if (result.page_count)      filled.add('page_count');
    if (result.isbn_10)         filled.add('isbn_10');
    if (result.isbn_13)         filled.add('isbn_13');
    if (description)            filled.add('description');
    setFilledByLookup(filled);
    setForm(f => ({
      ...f,
      title:     result.title || f.title,
      authors:   result.authors?.length ? result.authors : f.authors,
      publisher: result.publisher || f.publisher,
      page_count: result.page_count || f.page_count,
      isbn_10: result.isbn_10 || f.isbn_10,
      isbn_13: result.isbn_13 || f.isbn_13,
      description: description || f.description,
    }));
    setDirty(true);
    if (result.cover_url && !coverActionRef.current) {
      coverActionRef.current = true;
      const coverEpoch = coverActionGuard.next();
      setCoverError(null);
      setCoverPreview(result.cover_url);
      setUploading(true);
      try {
        const { path } = await api.fetchCover(result.cover_url);
        if (!lookupApplyGuard.isFresh(lookupEpoch) || !coverActionGuard.isFresh(coverEpoch)) return;
        setCoverPreview(path);
        set('cover_path', path);
      } catch {
        // External URLs can't be stored as filenames and would break display
        // via toCoverUrl(), so cover_path must stay empty. Clearing the
        // preview too — leaving the external URL up would look like the
        // cover was applied when in fact nothing will persist on save.
        if (!lookupApplyGuard.isFresh(lookupEpoch) || !coverActionGuard.isFresh(coverEpoch)) return;
        setCoverPreview(null);
        setCoverError('Could not save lookup cover. Choose or paste another image.');
      } finally {
        coverActionRef.current = false;
        if (coverActionGuard.isFresh(coverEpoch)) setUploading(false);
      }
    }
  }

  async function fetchCoverFromIsbn() {
    if (coverActionRef.current) return;
    coverActionRef.current = true;
    const epoch = coverActionGuard.next();
    // Mark dirty before the network call so the navigation blocker
    // fires if the user backs out mid-fetch. Without this, a fetch
    // started on an otherwise-clean form leaks the cover file to
    // /uploads/ on completion if navigation happened during the
    // in-flight window. Same rationale for uploadFile and
    // fetchAndSetCover below.
    setDirty(true);
    setCoverError(null);
    setFetchingCover(true);
    try {
      const updated = await api.fetchBookCover(id);
      if (!coverActionGuard.isFresh(epoch)) return;
      setCoverPreview(updated.cover_path);
      set('cover_path', updated.cover_path);
    } catch (e) {
      if (!coverActionGuard.isFresh(epoch)) return;
      setCoverError(e.message || 'Failed to fetch cover');
    } finally {
      // Clear the lock unconditionally so a stranded ref can't block
      // future cover ops if this epoch has been superseded.
      coverActionRef.current = false;
      // Only clear the spinner if this action is still current — otherwise
      // we'd kill a newer action's in-flight indicator.
      if (coverActionGuard.isFresh(epoch)) setFetchingCover(false);
    }
  }

  async function uploadFile(file) {
    if (coverActionRef.current) return;
    coverActionRef.current = true;
    const epoch = coverActionGuard.next();
    setDirty(true);
    setCoverPreview(URL.createObjectURL(file));
    setCoverError(null);
    setUploading(true);
    try {
      const result = await api.uploadCover(file);
      if (!coverActionGuard.isFresh(epoch)) return;
      set('cover_path', result.path);
      setCoverPreview(result.path);
    } catch (e) {
      if (!coverActionGuard.isFresh(epoch)) return;
      setCoverPreview(null);
      setCoverError(e.message || 'Upload failed');
    } finally {
      coverActionRef.current = false;
      if (coverActionGuard.isFresh(epoch)) setUploading(false);
    }
  }

  useEffect(() => {
    async function fetchAndSetCover(url) {
      if (coverActionRef.current) return;
      coverActionRef.current = true;
      const epoch = coverActionGuard.next();
      setDirty(true);
      setCoverPreview(url);
      setCoverError(null);
      setUploading(true);
      try {
        const result = await api.fetchCover(url);
        if (!coverActionGuard.isFresh(epoch)) return;
        set('cover_path', result.path);
        setCoverPreview(result.path);
      } catch (e) {
        if (!coverActionGuard.isFresh(epoch)) return;
        setCoverPreview(null);
        setCoverError(e.message || 'Failed to fetch cover');
      } finally {
        coverActionRef.current = false;
        if (coverActionGuard.isFresh(epoch)) setUploading(false);
      }
    }

    function handlePaste(e) {
      // Mirror the picker-button disabled state: a paste while a cover
      // upload/fetch is in flight would parse the clipboard and dispatch
      // to uploadFile / fetchAndSetCover, which then silently no-op
      // because they each check the same ref. Bailing here keeps the
      // lock contract visible at every entry point.
      if (coverActionRef.current) return;
      const items = Array.from(e.clipboardData?.items || []);

      // Binary image data — highest priority
      const imageItem = items.find(i => i.type.startsWith('image/'));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) { uploadFile(file); return; }
      }

      // Don't intercept pastes into text fields
      const tag = e.target.tagName;
      const isTextField = (tag === 'INPUT' && e.target.type !== 'file') || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isTextField) return;

      // text/html — browsers often include this when copying an image via right-click,
      // even when no binary data is present (CORS-restricted images, etc.)
      const htmlItem = items.find(i => i.type === 'text/html');
      if (htmlItem) {
        htmlItem.getAsString((html) => {
          const m = html.match(/src=["']([^"']+)["']/);
          if (m?.[1]?.startsWith('https://')) { fetchAndSetCover(m[1]); return; }
          const textItem = items.find(i => i.type === 'text/plain');
          if (textItem) textItem.getAsString((text) => {
            const url = text.trim();
            if (url.startsWith('https://')) fetchAndSetCover(url);
          });
        });
        return;
      }

      // Plain text URL
      const textItem = items.find(i => i.type === 'text/plain');
      if (textItem) textItem.getAsString((text) => {
        const url = text.trim();
        if (url.startsWith('https://')) fetchAndSetCover(url);
      });
    }

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    // Mirror the gating conditions on the submit button — pressing Enter in
    // any field would otherwise bypass the disabled button and submit. The
    // loadError / loadingBook cases are load-bearing: submitting during the
    // edit-load gap PUTs FORM_DEFAULTS over the real book, which is the
    // data-loss path we already plugged at the button level.
    if (uploading || fetchingCover || loadingBook || loadError) return;
    if (!form.title.trim()) { setActiveTab('core'); return; }
    if (!saveGuard.begin()) return;
    setError(null);
    try {
      const payload = formStateToPayload(form, { tagInput, narratorInput, authorInput, translatorInput });
      // `justSaved` mirrors the `justFinished` flag's plumbing — a one-shot
      // hint to BookDetail that the user landed there from a save and
      // benefits from an explicit "saved" ack. Without it, the navigate is
      // silent and easy to misread as a no-op on slow connections.
      const stateWithAck = { ...(navState ?? {}), justSaved: true };
      if (isEdit) {
        await api.updateBook(id, payload);
        setDirty(false);  // clear before navigate so the blocker doesn't fire
        navigate(`/books/${id}`, { state: stateWithAck });
      } else {
        const book = await api.createBook(payload);
        setDirty(false);
        navigate(`/books/${book.id}`, { state: stateWithAck });
      }
    } catch (err) {
      // Generic fallback if the thrown error has no `.message` — keeps
      // the user from seeing a blank error banner on a save failure.
      // Validation 400s carry an `err.field` echoed from the server; route
      // the user to the tab that hosts the offending field and append the
      // tab name to the banner so the field is locatable at a glance.
      const tabKey = err?.field && FIELD_TO_TAB[err.field];
      const tab = tabKey && TABS.find(t => t.key === tabKey);
      if (tab) {
        setActiveTab(tabKey);
        setError(`${err?.message ?? 'Failed to save book.'} (${tab.label} tab)`);
      } else {
        setError(err?.message || 'Failed to save book.');
      }
      // Clear only on failure — on success the component unmounts via
      // navigate, so leaving the guard latched is moot.
      saveGuard.end();
    }
  }

  const ic = (field) => filledByLookup.has(field) ? inputFilled : input;

  // Back-link target/state. The two values must agree on `isEdit` —
  // edit mode returns to the book's detail page and forwards navState
  // so BookDetail's own back link restores the original chain (Library
  // → Book → Edit → Back → Book → Library). New-book mode returns
  // directly to the origin (Library / Loved / AuthorsIndex / etc.) and
  // clears state — those pages render IncomingBackLink when state.from
  // is set, which would otherwise draw a self-referential '← Library'
  // pointing at the same page the user just landed on.
  const backTo    = isEdit ? `/books/${id}` : (navState?.fromPath ?? '/');
  const backState = isEdit ? navState : null;
  // Back-link label parallels every other detail page's "← {context}"
  // pattern. Edit mode → the title the user is working on (so the link
  // reads as a clear hop back to the book itself); New-book mode → the
  // page they came from, defaulting to Library when navState is absent
  // (cold deep link to /add).
  const backLabel = isEdit
    ? (form.title?.trim() || 'Book')
    : (navState?.from ?? 'Library');

  return (
    <div className="max-w-2xl">
      <Link
        to={backTo}
        state={backState}
        title={backLabel}
        className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors max-w-md truncate"
      >
        ← {backLabel}
      </Link>
      <div className="mb-8">
        <PageHeading>{isEdit ? 'Edit book' : 'Add book'}</PageHeading>
      </div>

      {loadError && (
        <div role="alert" className="mb-6 px-3 py-2 bg-warn/10 border border-warn/30 rounded text-sm text-warn">
          {loadError} The form below shows defaults — saving has been disabled to avoid overwriting the book.
        </div>
      )}

      {!isEdit && <LookupPanel onApply={applyResult} coverInFlight={uploading || fetchingCover} />}

      <div className="flex gap-8 items-start">
        <CoverPicker
          format={form.format}
          coverPreview={coverPreview}
          uploading={uploading}
          coverError={coverError}
          showFetchFromIsbn={isEdit && Boolean(form.isbn_13 || form.isbn_10)}
          fetchingCover={fetchingCover}
          onFileSelected={uploadFile}
          onFetchFromIsbn={fetchCoverFromIsbn}
          onRemove={() => {
            // Clear locally; the actual file deletion happens server-side
            // on Save (PUT with cover_path=null hits the explicit-clear
            // branch in repository.js, which deletes the old file).
            setCoverPreview(null);
            setCoverError(null);
            set('cover_path', null);
          }}
        />

        <div className="flex-1 min-w-0">
          {/* Sticky just under the Nav (top-14 == h-14 nav height) so the
              tabs stay reachable while the long form body scrolls. top-20
              left a 24-pixel gap where scrolling content leaked through;
              top-14 butts the strip flush against the Nav. The form body
              scrolls behind, so the strip needs a solid bg to occlude it;
              z-30 keeps it above form content and below the z-50 Nav. */}
          <div role="tablist" aria-label="Form sections" className="flex gap-6 border-b border-neutral-800 mb-7 sticky top-14 z-30 bg-neutral-950 pt-3 shadow-[0_8px_8px_-6px_rgba(0,0,0,0.5)]">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                ref={el => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`book-form-tab-${t.key}`}
                aria-selected={activeTab === t.key}
                aria-controls={`book-form-panel-${t.key}`}
                tabIndex={activeTab === t.key ? 0 : -1}
                onClick={() => setActiveTab(t.key)}
                onKeyDown={e => handleTabKey(e, i)}
                className={`pb-3 text-sm border-b-2 -mb-px transition-colors duration-150 ${
                  activeTab === t.key
                    ? 'border-oak text-parchment font-medium'
                    : 'border-transparent text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form id="book-form" onSubmit={handleSubmit} className="pb-20">
            {activeTab === 'core' && (
              <div role="tabpanel" id="book-form-panel-core" aria-labelledby="book-form-tab-core">
                <CoreFields
                  form={form} setForm={setFormDirty} set={set} ic={ic} isEdit={isEdit}
                  pastAuthors={pastAuthors} pastSeries={pastSeries} pastNarrators={pastNarrators}
                  authorInput={authorInput}     setAuthorInput={setAuthorInput}
                  narratorInput={narratorInput} setNarratorInput={setNarratorInput}
                  durationH={durationH} setDurationH={onDurationH}
                  durationM={durationM} setDurationM={onDurationM}
                />
              </div>
            )}
            {activeTab === 'details' && (
              <div role="tabpanel" id="book-form-panel-details" aria-labelledby="book-form-tab-details">
                <DetailsFields
                  form={form} set={set} ic={ic}
                  pastLanguages={pastLanguages}
                  pastTranslators={pastTranslators}
                  pastPublishers={pastPublishers}
                  translatorInput={translatorInput} setTranslatorInput={setTranslatorInput}
                />
              </div>
            )}
            {activeTab === 'acquisition' && (
              <div role="tabpanel" id="book-form-panel-acquisition" aria-labelledby="book-form-tab-acquisition">
                <AcquisitionFields
                  form={form} setForm={setFormDirty} set={set}
                  pastSources={pastSources} shelfTree={shelfTree}
                />
              </div>
            )}
            {activeTab === 'personal' && (
              <div role="tabpanel" id="book-form-panel-personal" aria-labelledby="book-form-tab-personal">
                <PersonalFields
                  form={form} set={set}
                  pastTags={pastTags}
                  tagInput={tagInput} setTagInput={setTagInput}
                />
              </div>
            )}
          </form>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-neutral-950/90 backdrop-blur border-t border-neutral-800 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          {error            && <p role="alert" className="text-sm text-warn truncate">{error}</p>}
          {shelfTreeError   && <p role="alert" className="text-xs text-warn/80 truncate">{shelfTreeError}</p>}
          {suggestionsError && <p role="alert" className="text-xs text-warn/80 truncate">{suggestionsError}</p>}
        </div>
        <button
          form="book-form"
          type="submit"
          disabled={saveGuard.busy || uploading || fetchingCover || !!loadError || loadingBook}
          className="ml-auto bg-oak hover:bg-leather motion-safe:active:scale-[0.98] disabled:opacity-60 text-neutral-950 font-semibold px-6 py-2 rounded-md transition-[transform,background-color] ease-out duration-150 text-sm"
        >
          {saveGuard.busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add to library'}
        </button>
      </div>
    </div>
  );
}
