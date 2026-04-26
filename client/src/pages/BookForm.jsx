import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { realTagNames } from '../utils.js';
import StarRating from '../components/StarRating.jsx';
import ShelfPicker from '../components/ShelfPicker.jsx';

const EMPTY = {
  title: '',
  author: '',
  status: 'unread',
  owned: false,
  previously_owned: false,
  shelf_id: null,
  building_id: null,
  room_id: null,
  unit_id: null,
  is_custom: false,
  fiction: null,
  source_type: '',
  rating: null,
  date_started: '',
  date_finished: '',
  language: 'English',
  original_language: '',
  translator: '',
  publisher: '',
  series: '',
  series_number: '',
  acquisition_source: '',
  acquisition_date: '',
  year_published: '',
  year_approximate: false,
  year_edition: '',
  isbn_10: '',
  isbn_13: '',
  asin: '',
  shelf_room: '',
  shelf_unit: '',
  shelf_number: '',
  format: '',
  binding: '',
  condition: '',
  page_count: '',
  current_page: '',
  duration_minutes: '',
  narrator: '',
  description: '',
  notes: '',
  review: '',
  read_count: 0,
  tags: [],
  cover_path: null,
};

const CONDITION_GRADES = [
  { grade: 'New',       desc: 'Unread, no defects whatsoever' },
  { grade: 'Fine',      desc: 'Like new, imperceptible wear' },
  { grade: 'Very Good', desc: 'Minor wear, no damage' },
  { grade: 'Good',      desc: 'Average used copy, visible wear' },
  { grade: 'Fair',      desc: 'Heavily worn but complete and readable' },
  { grade: 'Poor',      desc: 'Damaged; may have writing or missing pages' },
];

function ConditionGuide() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-4 h-4 rounded-full border text-xs leading-none flex items-center justify-center transition-colors ${
          open
            ? 'border-oak/60 text-oak'
            : 'border-neutral-600 text-neutral-500 hover:border-neutral-400 hover:text-neutral-300'
        }`}
      >
        ?
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-20 w-64 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-3 space-y-2.5">
          {CONDITION_GRADES.map(({ grade, desc }) => (
            <div key={grade} className="flex gap-2.5">
              <span className="text-xs font-semibold text-neutral-300 w-20 flex-shrink-0">{grade}</span>
              <span className="text-xs text-neutral-500 leading-relaxed">{desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [tagInput, setTagInput] = useState('');
  const [coverPreview, setCoverPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [fetchingCover, setFetchingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pastSources, setPastSources] = useState([]);
  const [pastAuthors, setPastAuthors] = useState([]);
  const [pastPublishers, setPastPublishers] = useState([]);
  const [pastSeries, setPastSeries] = useState([]);
  const [pastTranslators, setPastTranslators] = useState([]);
  const [pastNarrators, setPastNarrators] = useState([]);
  const [pastRooms, setPastRooms] = useState([]);
  const [pastUnits, setPastUnits] = useState([]);
  const [pastLanguages, setPastLanguages] = useState([]);
  const [pastTags, setPastTags] = useState([]);
  const [shelfTree, setShelfTree] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupSearching, setLookupSearching] = useState(false);
  const [filledByLookup, setFilledByLookup] = useState(new Set());
  const [durationH, setDurationH] = useState('');
  const [durationM, setDurationM] = useState('');
  const searchTimeout = useRef(null);

  useEffect(() => {
    api.getShelfTree().then(setShelfTree).catch(() => {});
  }, []);

  useEffect(() => {
    api.getBooks().then(books => {
      setPastSources([...new Set(books.map(b => b.acquisition_source).filter(Boolean))].sort());
      setPastAuthors([...new Set(books.map(b => b.author).filter(Boolean))].sort());
      setPastPublishers([...new Set(books.map(b => b.publisher).filter(Boolean))].sort());
      setPastSeries([...new Set(books.map(b => b.series).filter(Boolean))].sort());
      setPastTranslators([...new Set(books.map(b => b.translator).filter(Boolean))].sort());
      setPastNarrators([...new Set(books.map(b => b.narrator).filter(Boolean))].sort());
      setPastRooms([...new Set(books.map(b => b.shelf_room).filter(Boolean))].sort());
      setPastUnits([...new Set(books.map(b => b.shelf_unit).filter(Boolean))].sort());
      setPastLanguages([...new Set([...books.map(b => b.language), ...books.map(b => b.original_language)].filter(Boolean))].sort());
      setPastTags([...new Set(books.flatMap(b => b.tags?.map(t => t.name) ?? []))].sort());
    });
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.getBook(id).then((book) => {
      setForm({
        title: book.title,
        author: book.author || '',
        status: book.status,
        owned: Boolean(book.owned),
        previously_owned: Boolean(book.previously_owned),
        shelf_id: book.shelf_id ?? null,
        building_id: book.building_id ?? null,
        room_id: book.room_id ?? null,
        unit_id: book.unit_id ?? null,
        is_custom: Boolean(book.is_custom),
        fiction: book.fiction === null || book.fiction === undefined ? null : Boolean(book.fiction),
        source_type: book.source_type || '',
        rating: book.rating ?? null,
        date_started: book.date_started || '',
        date_finished: book.date_finished || '',
        language: book.language || 'English',
        original_language: book.original_language || '',
        translator: book.translator || '',
        publisher: book.publisher || '',
        series: book.series || '',
        series_number: book.series_number ?? '',
        acquisition_source: book.acquisition_source || '',
        acquisition_date: book.acquisition_date || '',
        isbn_10: book.isbn_10 || '',
        isbn_13: book.isbn_13 || '',
        asin: book.asin || '',
        year_published: book.year_published ?? '',
        year_approximate: Boolean(book.year_approximate),
        year_edition: book.year_edition ?? '',
        shelf_room: book.shelf_room || '',
        shelf_unit: book.shelf_unit || '',
        shelf_number: book.shelf_number ?? '',
        description: book.description || '',
        format: book.format || '',
        binding: book.binding || '',
        condition: book.condition || '',
        page_count: book.page_count ?? '',
        current_page: book.current_page ?? '',
        duration_minutes: book.duration_minutes ?? '',
        narrator: book.narrator || '',
        notes: book.notes || '',
        review: book.review || '',
        read_count: book.read_count || 0,
        tags: realTagNames(book.tags),
        cover_path: book.cover_path || null,
      });
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

  function handleSearchInput(e) {
    const q = e.target.value;
    setSearchQuery(q);
    setSearchResults([]);
    clearTimeout(searchTimeout.current);
    if (!q.trim()) return;
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try { setSearchResults(await api.searchBooks(q)); }
      finally { setSearching(false); }
    }, 400);
  }

  async function applyResult(result) {
    const { description } = result.key ? await api.fetchBookDescription(result.key).catch(() => ({ description: null })) : { description: null };
    const filled = new Set();
    if (result.title)     filled.add('title');
    if (result.author)    filled.add('author');
    if (result.publisher) filled.add('publisher');
    if (result.page_count) filled.add('page_count');
    if (result.isbn_10)   filled.add('isbn_10');
    if (result.isbn_13)   filled.add('isbn_13');
    if (description)      filled.add('description');
    setFilledByLookup(filled);
    setForm(f => ({
      ...f,
      title: result.title || f.title,
      author: result.author || f.author,
      publisher: result.publisher || f.publisher,
      page_count: result.page_count || f.page_count,
      isbn_10: result.isbn_10 || f.isbn_10,
      isbn_13: result.isbn_13 || f.isbn_13,
      description: description || f.description,
    }));
    setSearchQuery('');
    setSearchResults([]);
    if (result.cover_url) {
      setCoverPreview(result.cover_url);
      try {
        const { path } = await api.fetchCover(result.cover_url);
        setCoverPreview(path);
        set('cover_path', path);
      } catch {
        set('cover_path', result.cover_url);
      }
    }
  }

  async function handleLookup() {
    const query = [form.title, form.author].filter(Boolean).join(' ');
    if (!query.trim()) return;
    setLookupSearching(true);
    setLookupResults([]);
    try { setLookupResults(await api.searchBooks(query)); }
    finally { setLookupSearching(false); }
  }

  async function applyLookupResult(result) {
    const hasCover = Boolean(form.cover_path);
    const { description } = result.key ? await api.fetchBookDescription(result.key).catch(() => ({ description: null })) : { description: null };
    const filled = new Set();
    if (!form.title       && result.title)      filled.add('title');
    if (!form.author      && result.author)     filled.add('author');
    if (!form.publisher   && result.publisher)  filled.add('publisher');
    if (!form.page_count  && result.page_count) filled.add('page_count');
    if (!form.isbn_10     && result.isbn_10)    filled.add('isbn_10');
    if (!form.isbn_13     && result.isbn_13)    filled.add('isbn_13');
    if (!form.description && description)       filled.add('description');
    setFilledByLookup(filled);
    setForm(f => ({
      ...f,
      title:       f.title       || result.title       || '',
      author:      f.author      || result.author      || '',
      publisher:   f.publisher   || result.publisher   || '',
      page_count:  f.page_count  || result.page_count  || '',
      isbn_10:     f.isbn_10     || result.isbn_10     || '',
      isbn_13:     f.isbn_13     || result.isbn_13     || '',
      description: f.description || description        || '',
    }));
    setLookupResults([]);
    if (result.cover_url && !hasCover) {
      setCoverPreview(result.cover_url);
      try {
        const { path } = await api.fetchCover(result.cover_url);
        setCoverPreview(path);
        set('cover_path', path);
      } catch {
        set('cover_path', result.cover_url);
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
    setUploading(true);
    try {
      const result = await api.uploadCover(file);
      set('cover_path', result.path);
    } finally {
      setUploading(false);
    }
  }

  async function fetchAndSetCover(url) {
    setCoverPreview(url);
    setUploading(true);
    try {
      const result = await api.fetchCover(url);
      set('cover_path', result.path);
      setCoverPreview(result.path);
    } catch {
      setCoverPreview(null);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
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
          // Fall through to text/plain check if no useful src found
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

  function addTag(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const tag = tagInput.trim().replace(/,$/, '');
    if (tag && !form.tags.includes(tag)) set('tags', [...form.tags, tag]);
    setTagInput('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setActiveTab('core'); return; }
    setSaving(true);
    setError(null);
    const pendingTag = tagInput.trim().replace(/,$/, '');
    const tags = pendingTag && !form.tags.includes(pendingTag) ? [...form.tags, pendingTag] : form.tags;
    try {
      const payload = {
        ...form,
        tags,
        title: form.title.trim(),
        author: form.author.trim() || null,
        date_started: form.date_started || null,
        date_finished: form.date_finished || null,
        acquisition_source: form.acquisition_source || null,
        notes: form.notes || null,
        page_count: form.page_count ? parseInt(form.page_count) : null,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
        year_published: form.year_published ? parseInt(form.year_published) : null,
        year_edition: form.year_edition ? parseInt(form.year_edition) : null,
        year_approximate: form.year_edition ? form.year_approximate : false,
        series_number: form.series_number !== '' ? parseFloat(form.series_number) : null,
      };
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

  const input = 'w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150';
  const inputFilled = 'w-full bg-neutral-800 border border-oak/40 ring-1 ring-oak/15 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-2 focus:ring-oak/20 transition-colors duration-150';
  const inputNoWidth = 'bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150';
  const label = 'block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider';
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

      {!isEdit && (
        <div className="relative mb-8">
          <input
            type="search"
            value={searchQuery}
            onChange={handleSearchInput}
            placeholder="Search Open Library to auto-fill…"
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-oak/60 focus:ring-1 focus:ring-oak/25 transition-colors duration-150"
          />
          {searching && <p className="absolute right-3 top-2.5 text-xs text-neutral-600">Searching…</p>}
          {searchResults.length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden shadow-xl">
              {searchResults.map((r) => (
                <li key={r.key}>
                  <button type="button" onClick={() => applyResult(r)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors">
                    {r.cover_url
                      ? <img src={r.cover_url} alt="" className="w-8 h-12 object-cover rounded flex-shrink-0" />
                      : <div className="w-8 h-12 bg-neutral-800 rounded flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate" title={r.title}>{r.title}</p>
                      {r.author && <p className="text-xs text-neutral-500 truncate">{r.author}</p>}
                      {r.publisher && <p className="text-xs text-neutral-600 truncate">{r.publisher}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-8 items-start">
        {/* Cover sidebar */}
        <div className="w-44 sm:w-52 flex-shrink-0 sticky top-20">
          <p className={label}>Cover</p>
          <div className={`${form.format === 'audiobook' ? 'aspect-square' : 'aspect-[2/3]'} bg-neutral-800 rounded overflow-hidden ring-1 ring-white/5 mb-3`}>
            {coverPreview
              ? <img src={coverPreview} alt="Preview" className="w-full h-full object-cover" />
              : <div className="w-full h-full" />}
          </div>
          <label className="cursor-pointer block text-center text-xs text-neutral-500 hover:text-neutral-200 border border-dashed border-neutral-700 hover:border-neutral-500 rounded-md px-2 py-2 transition-colors">
            {uploading ? 'Uploading…' : coverPreview ? 'Change' : 'Choose image'}
            <span className="block text-neutral-600 mt-0.5">or paste</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) uploadFile(e.target.files[0]); }} />
          </label>
          {isEdit && (form.isbn_13 || form.isbn_10) && (
            <button
              type="button"
              onClick={fetchCoverFromIsbn}
              disabled={fetchingCover}
              className="mt-2 w-full text-center text-xs text-neutral-600 hover:text-neutral-400 transition-colors disabled:opacity-50"
            >
              {fetchingCover ? 'Fetching…' : 'Fetch from ISBN'}
            </button>
          )}
        </div>

        {/* Tabs + form */}
        <div className="flex-1 min-w-0">
          {/* Tab nav */}
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
            {/* ── Core ── */}
            {activeTab === 'core' && (
              <div className="space-y-6">
                <div>
                  <label className={label}>Title *</label>
                  <input className={ic('title')} value={form.title}
                    onChange={(e) => set('title', e.target.value)}
                    placeholder="Book title" required autoFocus={!isEdit} />
                </div>

                <div>
                  <label className={label}>Author</label>
                  <input className={ic('author')} list="authors-list" value={form.author}
                    onChange={(e) => set('author', e.target.value)} placeholder="Author name" />
                  <datalist id="authors-list">
                    {pastAuthors.map(a => <option key={a} value={a} />)}
                  </datalist>
                </div>

                <div>
                  <label className={label}>Format</label>
                  <select className={input} value={form.format}
                    onChange={(e) => {
                      const f = e.target.value;
                      setForm(prev => ({
                        ...prev, format: f,
                        binding: f === 'physical' ? prev.binding : '',
                        condition: f === 'physical' ? prev.condition : '',
                        page_count: f === 'audiobook' ? '' : prev.page_count,
                        duration_minutes: f !== 'audiobook' ? '' : prev.duration_minutes,
                        shelf_id: f === 'physical' ? prev.shelf_id : null,
                        building_id: f === 'physical' ? prev.building_id : null,
                        room_id: f === 'physical' ? prev.room_id : null,
                        unit_id: f === 'physical' ? prev.unit_id : null,
                      }));
                      if (f !== 'audiobook') { setDurationH(''); setDurationM(''); }
                    }}>
                    <option value="">—</option>
                    <option value="physical">Physical</option>
                    <option value="ebook">Digital</option>
                    <option value="audiobook">Audiobook</option>
                  </select>
                </div>

                <div>
                  <label className={label}>Fiction / Non-fiction</label>
                  <select className={input} value={form.fiction === null ? '' : String(form.fiction)}
                    onChange={e => {
                      const val = e.target.value === '' ? null : e.target.value === 'true';
                      setForm(f => ({ ...f, fiction: val, source_type: val === false ? f.source_type : '' }));
                    }}>
                    <option value="">—</option>
                    <option value="true">Fiction</option>
                    <option value="false">Non-fiction</option>
                  </select>
                </div>

                {form.fiction === false && (
                  <div>
                    <label className={label}>Source</label>
                    <select className={input} value={form.source_type}
                      onChange={e => set('source_type', e.target.value)}>
                      <option value="">—</option>
                      <option value="primary">Primary source</option>
                      <option value="secondary">Secondary source</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className={label}>Series</label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <input className={input} list="series-list" value={form.series}
                        onChange={(e) => set('series', e.target.value)}
                        placeholder="e.g. The Wheel of Time…" />
                      <datalist id="series-list">
                        {pastSeries.map(s => <option key={s} value={s} />)}
                      </datalist>
                    </div>
                    {form.series && (
                      <div className="w-24">
                        <input
                          type="number" min="0" step="0.5"
                          className={`${input} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          value={form.series_number}
                          onChange={(e) => set('series_number', e.target.value)}
                          placeholder="#" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Lookup button temporarily disabled — UX TBD
                {(form.title || form.author) && (
                  <div className="relative">
                    ...
                  </div>
                )}
                */}

                <div>
                  <label className={label}>Status</label>
                  <select className={input} value={form.status}
                    onChange={(e) => {
                      const s = e.target.value;
                      const today = new Date().toISOString().slice(0, 10);
                      setForm(f => ({
                        ...f,
                        status: s,
                        read_count: s === 'finished' && f.read_count === 0 ? 1 : f.read_count,
                        date_started: s === 'reading' && !f.date_started ? today : f.date_started,
                        date_finished: s === 'finished' && !f.date_finished ? today : f.date_finished,
                      }));
                    }}>
                    <option value="unread">Unread</option>
                    <option value="reading">Reading</option>
                    <option value="paused">Paused</option>
                    <option value="finished">Finished</option>
                  </select>
                </div>

                {(form.status === 'reading' || form.status === 'paused' || form.status === 'finished') && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={label}>Date started</label>
                      <input type="date" className={input} value={form.date_started}
                        onChange={(e) => set('date_started', e.target.value)} />
                    </div>
                    {form.status === 'finished' && (
                      <div>
                        <label className={label}>Date finished</label>
                        <input type="date" className={input} value={form.date_finished}
                          onChange={(e) => set('date_finished', e.target.value)} />
                      </div>
                    )}
                    {(form.status === 'finished' || form.read_count > 0) && (
                      <div>
                        <label className={label}>Times read</label>
                        <input type="number" min="0" className={input} value={form.read_count}
                          onChange={(e) => set('read_count', parseInt(e.target.value) || 0)} />
                      </div>
                    )}
                  </div>
                )}

                {form.format === 'physical' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={label}>Binding</label>
                        <select className={input} value={form.binding}
                          onChange={(e) => set('binding', e.target.value)}>
                          <option value="">—</option>
                          <option value="paperback">Paperback</option>
                          <option value="hardcover">Hardcover</option>
                        </select>
                      </div>
                      {(form.owned || form.previously_owned) && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Condition</span>
                            <ConditionGuide />
                          </div>
                          <select className={input} value={form.condition}
                            onChange={(e) => set('condition', e.target.value)}>
                            <option value="">—</option>
                            <option value="new">New</option>
                            <option value="fine">Fine</option>
                            <option value="very good">Very Good</option>
                            <option value="good">Good</option>
                            <option value="fair">Fair</option>
                            <option value="poor">Poor</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className={label}>Page count</label>
                      <input type="number" min="1" max="99999" className={ic('page_count')}
                        value={form.page_count} onChange={(e) => set('page_count', e.target.value)}
                        placeholder="e.g. 342" />
                    </div>
                  </>
                )}

                {form.format === 'ebook' && (
                  <div>
                    <label className={label}>Page count</label>
                    <input type="number" min="1" max="99999" className={ic('page_count')}
                      value={form.page_count} onChange={(e) => set('page_count', e.target.value)}
                      placeholder="e.g. 342" />
                  </div>
                )}

                {form.format === 'audiobook' && (
                  <>
                    <div>
                      <label className={label}>Duration</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="0" max="999"
                          className={`${inputNoWidth} flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          value={durationH}
                          onChange={(e) => {
                            const h = e.target.value;
                            setDurationH(h);
                            const total = (parseInt(h) || 0) * 60 + (parseInt(durationM) || 0);
                            set('duration_minutes', h === '' && durationM === '' ? '' : total);
                          }}
                          placeholder="0"
                        />
                        <span className="text-neutral-500 text-sm flex-shrink-0">h</span>
                        <input
                          type="number" min="0" max="59"
                          className={`${inputNoWidth} w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          value={durationM}
                          onChange={(e) => {
                            const m = e.target.value;
                            setDurationM(m);
                            const total = (parseInt(durationH) || 0) * 60 + (parseInt(m) || 0);
                            set('duration_minutes', durationH === '' && m === '' ? '' : total);
                          }}
                          placeholder="0"
                        />
                        <span className="text-neutral-500 text-sm flex-shrink-0">m</span>
                      </div>
                    </div>
                    <div>
                      <label className={label}>Narrator</label>
                      <input className={input} list="narrators-list" value={form.narrator}
                        onChange={(e) => set('narrator', e.target.value)}
                        placeholder="e.g. J. R. R. Tolkien" />
                      <datalist id="narrators-list">
                        {pastNarrators.map(n => <option key={n} value={n} />)}
                      </datalist>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Details ── */}
            {activeTab === 'details' && (
              <div className="space-y-6">
                <div>
                  <label className={label}>Language</label>
                  <input className={input} list="languages-list" value={form.language}
                    onChange={(e) => set('language', e.target.value)}
                    placeholder="English" />
                  <datalist id="languages-list">
                    {pastLanguages.map(l => <option key={l} value={l} />)}
                  </datalist>
                </div>

                <div>
                  <label className={label}>Original language</label>
                  <input className={input} list="languages-list" value={form.original_language}
                    onChange={(e) => set('original_language', e.target.value)}
                    placeholder="If translated…" />
                </div>

                <div>
                  <label className={label}>Translator</label>
                  <input className={input} list="translators-list" value={form.translator}
                    onChange={(e) => set('translator', e.target.value)}
                    placeholder="e.g. James Legge" />
                  <datalist id="translators-list">
                    {pastTranslators.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>

                <div>
                  <label className={label}>Publisher</label>
                  <input className={ic('publisher')} list="publishers-list" value={form.publisher}
                    onChange={(e) => set('publisher', e.target.value)}
                    placeholder="e.g. Penguin, Tor, Picador…" />
                  <datalist id="publishers-list">
                    {pastPublishers.map(p => <option key={p} value={p} />)}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label}>Year published</label>
                    <input type="number" min="1" max="9999" className={input}
                      value={form.year_published} onChange={(e) => set('year_published', e.target.value)}
                      placeholder="e.g. 1965" />
                  </div>
                  <div>
                    <label className={label}>Edition year</label>
                    <input type="number" min="1" max="9999" className={input}
                      value={form.year_edition} onChange={(e) => set('year_edition', e.target.value)}
                      placeholder="e.g. 1999" />
                    {form.year_edition && (
                      <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={form.year_approximate}
                          onChange={(e) => set('year_approximate', e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-900 text-oak focus:ring-0 focus:ring-offset-0" />
                        <span className="text-xs text-neutral-500">approximate (ca.)</span>
                      </label>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label}>ISBN-10</label>
                    <input className={ic('isbn_10')} value={form.isbn_10}
                      onChange={(e) => set('isbn_10', e.target.value)}
                      placeholder="0000000000" />
                  </div>
                  <div>
                    <label className={label}>ISBN-13</label>
                    <input className={ic('isbn_13')} value={form.isbn_13}
                      onChange={(e) => set('isbn_13', e.target.value)}
                      placeholder="0000000000000" />
                  </div>
                  <div>
                    <label className={label}>ASIN</label>
                    <input className={ic('asin')} value={form.asin}
                      onChange={(e) => set('asin', e.target.value)}
                      placeholder="B000000000" />
                  </div>
                </div>

                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label className={label} style={{marginBottom:0}}>Description</label>
                    <span className="text-xs text-neutral-600">Markdown supported</span>
                  </div>
                  <textarea className={`${ic('description')} resize-none`} rows={6}
                    value={form.description} onChange={(e) => set('description', e.target.value)}
                    placeholder="Back-cover description…" />
                </div>
              </div>
            )}

            {/* ── Acquisition ── */}
            {activeTab === 'acquisition' && (
              <div className="space-y-6">
                <div className="space-y-2.5">
                  {!form.is_custom && (
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input type="checkbox" checked={form.owned}
                        onChange={(e) => {
                          const owned = e.target.checked;
                          setForm(f => ({ ...f, owned, previously_owned: owned ? false : f.previously_owned, ...(!owned && { condition: '' }) }));
                        }}
                        className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-oak focus:ring-0 focus:ring-offset-0" />
                      <span className="text-sm text-neutral-300">I own this book</span>
                    </label>
                  )}
                  {!form.is_custom && !form.owned && (
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input type="checkbox" checked={form.previously_owned}
                        onChange={(e) => set('previously_owned', e.target.checked)}
                        className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-oak focus:ring-0 focus:ring-offset-0" />
                      <span className="text-sm text-neutral-300">
                        Previously owned
                        <span className="text-neutral-600 ml-1.5">— once had it, no longer do</span>
                      </span>
                    </label>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input type="checkbox" checked={form.is_custom}
                      onChange={(e) => {
                        const is_custom = e.target.checked;
                        setForm(f => ({ ...f, is_custom, owned: is_custom ? true : f.owned, ...(is_custom && { acquisition_source: '', acquisition_date: '' }) }));
                      }}
                      className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-oak focus:ring-0 focus:ring-offset-0" />
                    <span className="text-sm text-neutral-300">
                      Custom collection
                      <span className="text-neutral-600 ml-1.5">— assembled by me, not commercially published</span>
                    </span>
                  </label>
                </div>

                {form.owned && form.format === 'physical' && (
                  <ShelfPicker
                    shelfId={form.shelf_id}
                    buildingId={form.building_id}
                    roomId={form.room_id}
                    unitId={form.unit_id}
                    onChange={({ buildingId, roomId, unitId, shelfId }) => setForm(f => ({ ...f, building_id: buildingId, room_id: roomId, unit_id: unitId, shelf_id: shelfId }))}
                    tree={shelfTree}
                  />
                )}

                {(form.owned || form.previously_owned) && !form.is_custom && (
                  <>
                    <div>
                      <label className={label}>Acquisition source</label>
                      <input className={input} list="sources-list" value={form.acquisition_source}
                        onChange={(e) => set('acquisition_source', e.target.value)}
                        placeholder="e.g. Chapters, Amazon, gift…" />
                      <datalist id="sources-list">
                        {pastSources.map(s => <option key={s} value={s} />)}
                      </datalist>
                    </div>

                    <div>
                      <label className={label}>Acquisition date</label>
                      {(() => {
                        const parts = (form.acquisition_date || '').split('-');
                        const acqYear  = parts[0] || '';
                        const acqMonth = parts[1] || '';
                        const acqDay   = parts[2] || '';
                        function setAcq(y, m, d) {
                          let v = y;
                          if (y && m) { v = `${y}-${m}`; if (d) v = `${y}-${m}-${d}`; }
                          set('acquisition_date', v);
                        }
                        return (
                          <div className="flex gap-2">
                            <input
                              type="number" min="1800" max="2099" placeholder="Year"
                              className={`w-24 ${inputNoWidth}`}
                              value={acqYear}
                              onChange={e => setAcq(e.target.value, acqYear && acqMonth ? acqMonth : '', acqYear && acqDay ? acqDay : '')}
                            />
                            <select
                              className={`flex-1 ${inputNoWidth}`}
                              value={acqMonth}
                              onChange={e => setAcq(acqYear, e.target.value, e.target.value ? acqDay : '')}
                            >
                              <option value="">Month</option>
                              {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                                <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
                              ))}
                            </select>
                            {acqMonth && (
                              <input
                                type="number" min="1" max="31" placeholder="Day"
                                className={`w-16 ${inputNoWidth}`}
                                value={acqDay ? parseInt(acqDay) : ''}
                                onChange={e => setAcq(acqYear, acqMonth, e.target.value ? String(parseInt(e.target.value)).padStart(2, '0') : '')}
                              />
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Personal ── */}
            {activeTab === 'personal' && (
              <div className="space-y-6">
                <div>
                  <label className={label}>Rating</label>
                  <StarRating value={form.rating} onChange={(v) => set('rating', v)} />
                  {form.rating && (
                    <button type="button" onClick={() => set('rating', null)}
                      className="text-xs text-neutral-600 hover:text-neutral-400 mt-1.5">
                      Clear rating
                    </button>
                  )}
                </div>

                <div>
                  <label className={label}>Tags</label>
                  {form.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {form.tags.map((t) => (
                        <span key={t} className="flex items-center gap-1 text-xs bg-neutral-800 text-neutral-300 px-2.5 py-1 rounded-full">
                          {t}
                          <button type="button" onClick={() => set('tags', form.tags.filter(x => x !== t))}
                            className="text-neutral-500 hover:text-white leading-none ml-0.5">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input className={input} list="tags-list" value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)} onKeyDown={addTag}
                    placeholder="Type a tag, press Enter or comma to add" />
                  <datalist id="tags-list">
                    {pastTags.filter(t => !form.tags.includes(t)).map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>

                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label className={label} style={{marginBottom:0}}>Notes</label>
                    <span className="text-xs text-neutral-600">Markdown supported</span>
                  </div>
                  <textarea className={`${input} resize-none`} rows={6}
                    value={form.notes} onChange={(e) => set('notes', e.target.value)}
                    placeholder="Your thoughts…" />
                </div>

                {(form.status === 'finished' || form.read_count > 0) && (
                  <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <label className={label} style={{marginBottom:0}}>Review</label>
                      <span className="text-xs text-neutral-600">Markdown supported</span>
                    </div>
                    <textarea className={`${input} resize-none`} rows={8}
                      value={form.review} onChange={(e) => set('review', e.target.value)}
                      placeholder="Your review…" />
                  </div>
                )}
              </div>
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
