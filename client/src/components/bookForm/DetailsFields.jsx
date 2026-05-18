import { useId } from 'react';
import ChipInput from './ChipInput.jsx';
import { input, label, MARKDOWN_HINT, submitOnModEnter } from './styles.js';

export default function DetailsFields({ form, set, ic, pastLanguages, pastTranslators, pastPublishers, translatorInput, setTranslatorInput }) {
  const idPfx = useId();
  const idFor = (k) => `${idPfx}-${k}`;
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor={idFor('language')} className={label}>Language</label>
        <input id={idFor('language')} className={input} list="languages-list" value={form.language}
          onChange={(e) => set('language', e.target.value)}
          placeholder="English" />
        <datalist id="languages-list">
          {pastLanguages.map(l => <option key={l} value={l} />)}
        </datalist>
      </div>

      <div>
        <label htmlFor={idFor('original_language')} className={label}>Original language</label>
        <input id={idFor('original_language')} className={input} list="languages-list" value={form.original_language}
          onChange={(e) => set('original_language', e.target.value)}
          placeholder="If translated…" />
      </div>

      <ChipInput
        label="Translators"
        items={form.translators}
        onItemsChange={(items) => set('translators', items)}
        inputValue={translatorInput}
        onInputChange={setTranslatorInput}
        datalistId="translators-list"
        datalistOptions={pastTranslators}
        placeholder="Type a name, press Enter or comma to add"
        inputClassName={input}
      />

      <div>
        <label htmlFor={idFor('publisher')} className={label}>Publisher</label>
        <input id={idFor('publisher')} className={ic('publisher')} list="publishers-list" value={form.publisher}
          onChange={(e) => set('publisher', e.target.value)}
          placeholder="e.g. Penguin, Tor, Picador…" />
        <datalist id="publishers-list">
          {pastPublishers.map(p => <option key={p} value={p} />)}
        </datalist>
      </div>

      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input type="checkbox" checked={form.abridged}
          onChange={(e) => set('abridged', e.target.checked)}
          className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-900 text-oak focus:ring-0 focus:ring-offset-0" />
        <span className="text-xs text-neutral-500">Abridged edition</span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={idFor('year_published')} className={label}>Year published</label>
          <input id={idFor('year_published')} type="number" min="-9999" max="9999" className={input}
            value={form.year_published} onChange={(e) => set('year_published', e.target.value)}
            placeholder="e.g. 1965 (BCE: -800)" />
          {form.year_published && (
            <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={form.year_published_approximate}
                onChange={(e) => set('year_published_approximate', e.target.checked)}
                className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-900 text-oak focus:ring-0 focus:ring-offset-0" />
              <span className="text-xs text-neutral-500">approximate (ca.)</span>
            </label>
          )}
        </div>
        <div>
          <label htmlFor={idFor('year_edition')} className={label}>Edition year</label>
          <input id={idFor('year_edition')} type="number" min="-9999" max="9999" className={input}
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
          <label htmlFor={idFor('isbn_10')} className={label}>ISBN-10</label>
          <input id={idFor('isbn_10')} className={ic('isbn_10')} value={form.isbn_10}
            onChange={(e) => set('isbn_10', e.target.value)}
            placeholder="0000000000" />
        </div>
        <div>
          <label htmlFor={idFor('isbn_13')} className={label}>ISBN-13</label>
          <input id={idFor('isbn_13')} className={ic('isbn_13')} value={form.isbn_13}
            onChange={(e) => set('isbn_13', e.target.value)}
            placeholder="0000000000000" />
        </div>
        <div>
          <label htmlFor={idFor('asin')} className={label}>ASIN</label>
          <input id={idFor('asin')} className={ic('asin')} value={form.asin}
            onChange={(e) => set('asin', e.target.value)}
            placeholder="B000000000" />
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label htmlFor={idFor('description')} className={label} style={{marginBottom:0}}>Description</label>
          <span className="text-xs text-neutral-600 cursor-help underline decoration-dotted decoration-neutral-700 underline-offset-2" title={MARKDOWN_HINT}>Markdown supported</span>
        </div>
        <textarea id={idFor('description')} className={`${ic('description')} resize-none`} rows={6}
          value={form.description} onChange={(e) => set('description', e.target.value)}
          onKeyDown={submitOnModEnter}
          placeholder="Back-cover description…" />
      </div>
    </div>
  );
}
