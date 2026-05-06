import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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

const TABS = [
  { key: 'core',        label: 'Core' },
  { key: 'details',     label: 'Details' },
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'personal',    label: 'Personal' },
];

export default function BookForm() {
  const { id } = useParams();
  const navigate = useNavigate();
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
  const [saving, setSaving] = useState(false);
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
  const editGenRef = useRef(0);
  // True while the edit-mode getBook fetch is in flight. Disables submit
  // so a user clicking Save during the gap can't PUT the previous book's
  // form data to the new id. Distinct from `saving` (which is the actual
  // save in progress) and `loadError` (set only on failure).
  const [loadingBook, setLoadingBook] = useState(false);
  // Stale-result guard for applyResult. Picking lookup result A, then
  // quickly picking B, used to let A's slower description/cover awaits
  // resolve after B's and overwrite B's form fields and cover state.
  const lookupApplyGenRef = useRef(0);
  // Stale-result guard for any cover-affecting action — fetchCoverFromIsbn,
  // uploadFile, the paste/drag fetchAndSetCover, AND applyResult's cover
  // branch. Shared across all four so any combo (paste-then-upload,
  // ISBN-then-pick, etc.) drops the slower one's writes and finally.
  const coverActionGenRef = useRef(0);
  const [durationH, setDurationH] = useState('');
  const [durationM, setDurationM] = useState('');

  useEffect(() => {
    let stale = false;
    setShelfTreeError(null);
    api.getShelfTree()
      .then(t => { if (!stale) setShelfTree(t); })
      .catch(() => { if (!stale) setShelfTreeError('Failed to load shelves — the shelf picker may be empty.'); });
    return () => { stale = true; };
  }, []);

  useEffect(() => {
    let stale = false;
    setSuggestionsError(null);
    api.getBookFacets().then(f => {
      if (stale) return;
      setPastSources(f.sources || []);
      setPastAuthors(f.authors || []);
      setPastPublishers(f.publishers || []);
      setPastSeries(f.series || []);
      setPastTranslators(f.translators || []);
      setPastNarrators(f.narrators || []);
      setPastLanguages(f.languages || []);
      setPastTags(f.tags?.filter(t => !VIRTUAL_TAG_NAMES.includes(t)) || []);
    }).catch(() => { if (!stale) setSuggestionsError('Failed to load suggestions — autocomplete lists may be empty.'); });
    return () => { stale = true; };
  }, []);

  useEffect(() => {
    if (!isEdit) {
      // Transitioning from edit-of-X to a non-edit context (e.g. /books/new):
      // bump the gen so any in-flight getBook(X) drops its setForm on
      // resolve, and clear loadingBook so the submit button isn't gated
      // forever. Without these, the new-book form could end up populated
      // with X's data, AND the submit button stays disabled latently.
      ++editGenRef.current;
      setLoadingBook(false);
      return;
    }
    const gen = ++editGenRef.current;
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
      if (gen !== editGenRef.current) return;
      setForm(bookToFormState(book));
      if (book.duration_minutes) {
        setDurationH(String(Math.floor(book.duration_minutes / 60)));
        setDurationM(String(book.duration_minutes % 60));
      }
      if (book.cover_path) setCoverPreview(book.cover_path);
    })
      .catch(() => { if (gen === editGenRef.current) setLoadError('Failed to load book.'); })
      .finally(() => { if (gen === editGenRef.current) setLoadingBook(false); });
  }, [id, isEdit]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFilledByLookup(s => { if (!s.has(field)) return s; const n = new Set(s); n.delete(field); return n; });
  }

  async function applyResult(result) {
    const gen = ++lookupApplyGenRef.current;
    const { description } = result.key ? await api.fetchBookDescription(result.key).catch(() => ({ description: null })) : { description: null };
    if (gen !== lookupApplyGenRef.current) return;
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
    if (result.cover_url) {
      const coverGen = ++coverActionGenRef.current;
      setCoverError(null);
      setCoverPreview(result.cover_url);
      try {
        const { path } = await api.fetchCover(result.cover_url);
        if (gen !== lookupApplyGenRef.current || coverGen !== coverActionGenRef.current) return;
        setCoverPreview(path);
        set('cover_path', path);
      } catch {
        // External URLs can't be stored as filenames and would break display
        // via toCoverUrl(), so cover_path must stay empty. Clearing the
        // preview too — leaving the external URL up would look like the
        // cover was applied when in fact nothing will persist on save.
        if (gen !== lookupApplyGenRef.current || coverGen !== coverActionGenRef.current) return;
        setCoverPreview(null);
        setCoverError('Could not save lookup cover. Choose or paste another image.');
      }
    }
  }

  async function fetchCoverFromIsbn() {
    const gen = ++coverActionGenRef.current;
    setCoverError(null);
    setFetchingCover(true);
    try {
      const updated = await api.fetchBookCover(id);
      if (gen !== coverActionGenRef.current) return;
      setCoverPreview(updated.cover_path);
      set('cover_path', updated.cover_path);
    } catch (e) {
      if (gen !== coverActionGenRef.current) return;
      setCoverError(e.message || 'Failed to fetch cover');
    } finally {
      // Only clear the spinner if this action is still current — otherwise
      // we'd kill a newer action's in-flight indicator.
      if (gen === coverActionGenRef.current) setFetchingCover(false);
    }
  }

  async function uploadFile(file) {
    const gen = ++coverActionGenRef.current;
    setCoverPreview(URL.createObjectURL(file));
    setCoverError(null);
    setUploading(true);
    try {
      const result = await api.uploadCover(file);
      if (gen !== coverActionGenRef.current) return;
      set('cover_path', result.path);
    } catch (e) {
      if (gen !== coverActionGenRef.current) return;
      setCoverPreview(null);
      setCoverError(e.message || 'Upload failed');
    } finally {
      if (gen === coverActionGenRef.current) setUploading(false);
    }
  }

  useEffect(() => {
    async function fetchAndSetCover(url) {
      const gen = ++coverActionGenRef.current;
      setCoverPreview(url);
      setCoverError(null);
      setUploading(true);
      try {
        const result = await api.fetchCover(url);
        if (gen !== coverActionGenRef.current) return;
        set('cover_path', result.path);
        setCoverPreview(result.path);
      } catch (e) {
        if (gen !== coverActionGenRef.current) return;
        setCoverPreview(null);
        setCoverError(e.message || 'Failed to fetch cover');
      } finally {
        if (gen === coverActionGenRef.current) setUploading(false);
      }
    }

    function handlePaste(e) {
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
    if (saving || uploading || loadingBook || loadError) return;
    if (!form.title.trim()) { setActiveTab('core'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = formStateToPayload(form, { tagInput, narratorInput, authorInput, translatorInput });
      if (isEdit) {
        await api.updateBook(id, payload);
        navigate(`/books/${id}`);
      } else {
        const book = await api.createBook(payload);
        navigate(`/books/${book.id}`);
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const ic = (field) => filledByLookup.has(field) ? inputFilled : input;

  return (
    <div className="max-w-2xl">
      <Link
        to={isEdit ? `/books/${id}` : '/'}
        className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors"
      >
        ← Back
      </Link>
      <h1 className="text-xl font-bold text-white mb-8">
        {isEdit ? 'Edit book' : 'Add book'}
      </h1>

      {loadError && (
        <div className="mb-6 px-3 py-2 bg-warn/10 border border-warn/30 rounded text-sm text-warn">
          {loadError} The form below shows defaults — saving has been disabled to avoid overwriting the book.
        </div>
      )}

      {!isEdit && <LookupPanel onApply={applyResult} />}

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
        />

        <div className="flex-1 min-w-0">
          <div className="flex gap-6 border-b border-neutral-800 mb-7">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
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
              <CoreFields
                form={form} setForm={setForm} set={set} ic={ic} isEdit={isEdit}
                pastAuthors={pastAuthors} pastSeries={pastSeries} pastNarrators={pastNarrators}
                authorInput={authorInput}     setAuthorInput={setAuthorInput}
                narratorInput={narratorInput} setNarratorInput={setNarratorInput}
                durationH={durationH} setDurationH={setDurationH}
                durationM={durationM} setDurationM={setDurationM}
              />
            )}
            {activeTab === 'details' && (
              <DetailsFields
                form={form} set={set} ic={ic}
                pastLanguages={pastLanguages}
                pastTranslators={pastTranslators}
                pastPublishers={pastPublishers}
                translatorInput={translatorInput} setTranslatorInput={setTranslatorInput}
              />
            )}
            {activeTab === 'acquisition' && (
              <AcquisitionFields
                form={form} setForm={setForm} set={set}
                pastSources={pastSources} shelfTree={shelfTree}
              />
            )}
            {activeTab === 'personal' && (
              <PersonalFields
                form={form} set={set}
                pastTags={pastTags}
                tagInput={tagInput} setTagInput={setTagInput}
              />
            )}
          </form>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-neutral-950/90 backdrop-blur border-t border-neutral-800 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          {error            && <p className="text-sm text-warn truncate">{error}</p>}
          {shelfTreeError   && <p className="text-xs text-warn/80 truncate">{shelfTreeError}</p>}
          {suggestionsError && <p className="text-xs text-warn/80 truncate">{suggestionsError}</p>}
        </div>
        <button
          form="book-form"
          type="submit"
          disabled={saving || uploading || !!loadError || loadingBook}
          className="ml-auto bg-oak hover:bg-leather active:scale-[0.98] disabled:opacity-40 text-neutral-950 font-semibold px-6 py-2 rounded-md transition-[transform,background-color] ease-out duration-150 text-sm"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to library'}
        </button>
      </div>
    </div>
  );
}
