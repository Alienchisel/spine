import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import StarRating from '../components/StarRating.jsx';


const EMPTY = {
  title: '',
  author: '',
  status: 'unread',
  owned: false,
  rating: null,
  date_started: '',
  date_finished: '',
  publisher: '',
  series: '',
  acquisition_source: '',
  format: '',
  binding: '',
  condition: '',
  page_count: '',
  current_page: '',
  duration_minutes: '',
  description: '',
  notes: '',
  tags: [],
  cover_path: null,
};

export default function BookForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(EMPTY);
  const [tagInput, setTagInput] = useState('');
  const [coverPreview, setCoverPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pastSources, setPastSources] = useState([]);
  const [pastAuthors, setPastAuthors] = useState([]);
  const [pastPublishers, setPastPublishers] = useState([]);
  const [pastSeries, setPastSeries] = useState([]);

  useEffect(() => {
    api.getBooks().then(books => {
      const sources = [...new Set(books.map(b => b.acquisition_source).filter(Boolean))].sort();
      const authors = [...new Set(books.map(b => b.author).filter(Boolean))].sort();
      const publishers = [...new Set(books.map(b => b.publisher).filter(Boolean))].sort();
      const series = [...new Set(books.map(b => b.series).filter(Boolean))].sort();
      setPastSources(sources);
      setPastAuthors(authors);
      setPastPublishers(publishers);
      setPastSeries(series);
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
        rating: book.rating ?? null,
        date_started: book.date_started || '',
        date_finished: book.date_finished || '',
        publisher: book.publisher || '',
        series: book.series || '',
        acquisition_source: book.acquisition_source || '',
        description: book.description || '',
        format: book.format || '',
        binding: book.binding || '',
        condition: book.condition || '',
        page_count: book.page_count ?? '',
        current_page: book.current_page ?? '',
        duration_minutes: book.duration_minutes ?? '',
        notes: book.notes || '',
        tags: book.tags?.map((t) => t.name) || [],
        cover_path: book.cover_path || null,
      });
      if (book.cover_path) setCoverPreview(book.cover_path);
    });
  }, [id, isEdit]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
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

  async function handleCoverChange(e) {
    const file = e.target.files[0];
    if (file) uploadFile(file);
  }

  useEffect(() => {
    function handlePaste(e) {
      const item = Array.from(e.clipboardData?.items || []).find(
        (i) => i.type.startsWith('image/')
      );
      if (item) uploadFile(item.getAsFile());
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  function addTag(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const tag = tagInput.trim().replace(/,$/, '');
    if (tag && !form.tags.includes(tag)) {
      set('tags', [...form.tags, tag]);
    }
    setTagInput('');
  }

  function removeTag(tag) {
    set('tags', form.tags.filter((t) => t !== tag));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        author: form.author.trim() || null,
        date_started: form.date_started || null,
        date_finished: form.date_finished || null,
        acquisition_source: form.acquisition_source || null,
        notes: form.notes || null,
        page_count: form.page_count ? parseInt(form.page_count) : null,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
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

  const input = 'w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors';
  const label = 'block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider';

  return (
    <div className="max-w-lg">
      <Link
        to={isEdit ? `/books/${id}` : '/'}
        className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors"
      >
        ← Back
      </Link>
      <h1 className="text-xl font-bold text-white mb-8">
        {isEdit ? 'Edit book' : 'Add book'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cover */}
        <div>
          <label className={label}>Cover</label>
          <div className="flex gap-5 items-start">
            <div className="w-20 aspect-[2/3] bg-neutral-800 rounded overflow-hidden flex-shrink-0 ring-1 ring-white/5">
              {coverPreview ? (
                <img src={coverPreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full" />
              )}
            </div>
            <label className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-200 border border-dashed border-neutral-700 hover:border-neutral-500 rounded-md px-4 py-2.5 transition-colors mt-1">
              {uploading ? 'Uploading…' : coverPreview ? 'Change image' : 'Choose image'}
              <span className="block text-xs text-neutral-600 mt-0.5">or paste from clipboard</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
            </label>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className={label}>Title *</label>
          <input
            className={input}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Book title"
            required
            autoFocus={!isEdit}
          />
        </div>

        {/* Author */}
        <div>
          <label className={label}>Author</label>
          <input
            className={input}
            list="authors-list"
            value={form.author}
            onChange={(e) => set('author', e.target.value)}
            placeholder="Author name"
          />
          <datalist id="authors-list">
            {pastAuthors.map((a) => <option key={a} value={a} />)}
          </datalist>
        </div>

        {/* Status */}
        <div>
          <label className={label}>Status</label>
          <select
            className={input}
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="finished">Finished</option>
          </select>
        </div>

        {/* Dates */}
        {(form.status === 'reading' || form.status === 'finished') && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Date started</label>
              <input
                type="date"
                className={input}
                value={form.date_started}
                onChange={(e) => set('date_started', e.target.value)}
              />
            </div>
            {form.status === 'finished' && (
              <div>
                <label className={label}>Date finished</label>
                <input
                  type="date"
                  className={input}
                  value={form.date_finished}
                  onChange={(e) => set('date_finished', e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* Owned */}
        <div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.owned}
              onChange={(e) => set('owned', e.target.checked)}
              className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-sm text-neutral-300">I own this book</span>
          </label>
        </div>

        {/* Acquisition source */}
        <div>
          <label className={label}>Acquisition source</label>
          <input
            className={input}
            list="sources-list"
            value={form.acquisition_source}
            onChange={(e) => set('acquisition_source', e.target.value)}
            placeholder="e.g. Waterstones, Amazon, gift…"
          />
          <datalist id="sources-list">
            {pastSources.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>

        {/* Publisher */}
        <div>
          <label className={label}>Publisher</label>
          <input
            className={input}
            list="publishers-list"
            value={form.publisher}
            onChange={(e) => set('publisher', e.target.value)}
            placeholder="e.g. Penguin, Tor, Bloomsbury…"
          />
          <datalist id="publishers-list">
            {pastPublishers.map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>

        {/* Series */}
        <div>
          <label className={label}>Series</label>
          <input
            className={input}
            list="series-list"
            value={form.series}
            onChange={(e) => set('series', e.target.value)}
            placeholder="e.g. The Stormlight Archive…"
          />
          <datalist id="series-list">
            {pastSeries.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>

        {/* Format */}
        <div>
          <label className={label}>Format</label>
          <select
            className={input}
            value={form.format}
            onChange={(e) => {
              set('format', e.target.value);
              if (e.target.value !== 'physical') {
                set('binding', '');
                set('condition', '');
              }
            }}
          >
            <option value="">—</option>
            <option value="physical">Physical</option>
            <option value="ebook">E-book</option>
            <option value="audiobook">Audiobook</option>
          </select>
        </div>

        {form.format === 'physical' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Binding</label>
                <select
                  className={input}
                  value={form.binding}
                  onChange={(e) => set('binding', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="paperback">Paperback</option>
                  <option value="hardcover">Hardcover</option>
                </select>
              </div>
              <div>
                <label className={label}>Condition</label>
                <select
                  className={input}
                  value={form.condition}
                  onChange={(e) => set('condition', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="new">New</option>
                  <option value="used">Used</option>
                </select>
              </div>
            </div>
            <div>
              <label className={label}>Page count</label>
              <input
                type="number"
                min="1"
                max="99999"
                className={input}
                value={form.page_count}
                onChange={(e) => set('page_count', e.target.value)}
                placeholder="e.g. 342"
              />
            </div>
          </>
        )}

        {form.format === 'ebook' && (
          <div>
            <label className={label}>Page count</label>
            <input
              type="number"
              min="1"
              max="99999"
              className={input}
              value={form.page_count}
              onChange={(e) => set('page_count', e.target.value)}
              placeholder="e.g. 342"
            />
          </div>
        )}

        {form.format === 'audiobook' && (
          <div>
            <label className={label}>Duration (minutes)</label>
            <input
              type="number"
              min="1"
              max="99999"
              className={input}
              value={form.duration_minutes}
              onChange={(e) => set('duration_minutes', e.target.value)}
              placeholder="e.g. 680"
            />
          </div>
        )}

        {/* Tags */}
        <div>
          <label className={label}>Tags</label>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 text-xs bg-neutral-800 text-neutral-300 px-2.5 py-1 rounded-full"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="text-neutral-500 hover:text-white leading-none ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            className={input}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={addTag}
            placeholder="Type a tag, press Enter or comma to add"
          />
        </div>

        {/* Rating */}
        <div>
          <label className={label}>Rating</label>
          <StarRating value={form.rating} onChange={(v) => set('rating', v)} />
          {form.rating && (
            <button
              type="button"
              onClick={() => set('rating', null)}
              className="text-xs text-neutral-600 hover:text-neutral-400 mt-1.5"
            >
              Clear rating
            </button>
          )}
        </div>

        {/* Description */}
        <div>
          <label className={label}>Description</label>
          <textarea
            className={`${input} resize-none`}
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Back-cover description…"
          />
        </div>

        {/* Notes */}
        <div>
          <label className={label}>Notes</label>
          <textarea
            className={`${input} resize-none`}
            rows={4}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Your thoughts…"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={saving || uploading}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold py-3 rounded-md transition-colors"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to library'}
        </button>
      </form>
    </div>
  );
}
