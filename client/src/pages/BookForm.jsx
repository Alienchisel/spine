import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { EMPTY, VIRTUAL_TAG_NAMES } from '../components/bookForm/defaults.js';
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
  const [form, setForm] = useState(EMPTY);
  const [activeTab, setActiveTab] = useState('core');
  const [tagInput,      setTagInput]      = useState('');
  const [narratorInput, setNarratorInput] = useState('');
  const [authorInput,   setAuthorInput]   = useState('');
  const [coverPreview, setCoverPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [coverError, setCoverError] = useState(null);
  const [fetchingCover, setFetchingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
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
  const [durationH, setDurationH] = useState('');
  const [durationM, setDurationM] = useState('');

  useEffect(() => {
    api.getShelfTree().then(setShelfTree).catch(() => {});
  }, []);

  useEffect(() => {
    api.getBookFacets().then(f => {
      setPastSources(f.sources || []);
      setPastAuthors(f.authors || []);
      setPastPublishers(f.publishers || []);
      setPastSeries(f.series || []);
      setPastTranslators(f.translators || []);
      setPastNarrators(f.narrators || []);
      setPastLanguages(f.languages || []);
      setPastTags(f.tags?.filter(t => !VIRTUAL_TAG_NAMES.includes(t)) || []);
    });
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.getBook(id).then((book) => {
      setForm(bookToFormState(book));
      if (book.duration_minutes) {
        setDurationH(String(Math.floor(book.duration_minutes / 60)));
        setDurationM(String(book.duration_minutes % 60));
      }
      if (book.cover_path) setCoverPreview(book.cover_path);
    });
  }, [id, isEdit]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFilledByLookup(s => { if (!s.has(field)) return s; const n = new Set(s); n.delete(field); return n; });
  }

  async function applyResult(result) {
    const { description } = result.key ? await api.fetchBookDescription(result.key).catch(() => ({ description: null })) : { description: null };
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
      setCoverPreview(result.cover_url);
      try {
        const { path } = await api.fetchCover(result.cover_url);
        setCoverPreview(path);
        set('cover_path', path);
      } catch {
        // preview stays as external URL but cover_path stays empty — external URLs
        // can't be stored as filenames and would break display via toCoverUrl()
      }
    }
  }

  async function fetchCoverFromIsbn() {
    setFetchingCover(true);
    try {
      const updated = await api.fetchBookCover(id);
      setCoverPreview(updated.cover_path);
      set('cover_path', updated.cover_path);
    } catch (e) {
      setError(e.message);
    } finally {
      setFetchingCover(false);
    }
  }

  async function uploadFile(file) {
    setCoverPreview(URL.createObjectURL(file));
    setCoverError(null);
    setUploading(true);
    try {
      const result = await api.uploadCover(file);
      set('cover_path', result.path);
    } catch (e) {
      setCoverPreview(null);
      setCoverError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    async function fetchAndSetCover(url) {
      setCoverPreview(url);
      setCoverError(null);
      setUploading(true);
      try {
        const result = await api.fetchCover(url);
        set('cover_path', result.path);
        setCoverPreview(result.path);
      } catch (e) {
        setCoverPreview(null);
        setCoverError(e.message || 'Failed to fetch cover');
      } finally {
        setUploading(false);
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
    if (!form.title.trim()) { setActiveTab('core'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = formStateToPayload(form, { tagInput, narratorInput, authorInput });
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
        {error && <p className="text-sm text-warn truncate">{error}</p>}
        <button
          form="book-form"
          type="submit"
          disabled={saving || uploading}
          className="ml-auto bg-oak hover:bg-leather active:scale-[0.98] disabled:opacity-40 text-neutral-950 font-semibold px-6 py-2 rounded-md transition-[transform,background-color] ease-out duration-150 text-sm"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to library'}
        </button>
      </div>
    </div>
  );
}
