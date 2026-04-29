import { label as labelClass } from './styles.js';

export default function CoverPicker({
  format,
  coverPreview,
  uploading,
  coverError,
  showFetchFromIsbn,
  fetchingCover,
  onFileSelected,
  onFetchFromIsbn,
}) {
  return (
    <div className="w-44 sm:w-52 flex-shrink-0 sticky top-20">
      <p className={labelClass}>Cover</p>
      <div className={`${format === 'audiobook' ? 'aspect-square' : 'aspect-[2/3]'} bg-neutral-800 rounded overflow-hidden ring-1 ring-white/5 mb-3`}>
        {coverPreview
          ? <img src={coverPreview} alt="Preview" className="w-full h-full object-cover" />
          : <div className="w-full h-full" />}
      </div>
      <label className="cursor-pointer block text-center text-xs text-neutral-500 hover:text-neutral-200 border border-dashed border-neutral-700 hover:border-neutral-500 rounded-md px-2 py-2 transition-colors">
        {uploading ? 'Uploading…' : coverPreview ? 'Change' : 'Choose image'}
        <span className="block text-neutral-600 mt-0.5">or paste</span>
        <input type="file" accept="image/*" className="hidden"
          onChange={(e) => { if (e.target.files[0]) onFileSelected(e.target.files[0]); }} />
      </label>
      {coverError && (
        <p className="mt-2 text-xs text-warn text-center">{coverError}</p>
      )}
      {showFetchFromIsbn && (
        <button
          type="button"
          onClick={onFetchFromIsbn}
          disabled={fetchingCover}
          className="mt-2 w-full text-center text-xs text-neutral-600 hover:text-neutral-400 transition-colors disabled:opacity-50"
        >
          {fetchingCover ? 'Fetching…' : 'Fetch from ISBN'}
        </button>
      )}
    </div>
  );
}
