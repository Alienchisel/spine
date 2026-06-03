import StarRating from '../StarRating.jsx';
import ChipInput from './ChipInput.jsx';
import MentionTextarea from './MentionTextarea.jsx';
import { input, label, MARKDOWN_HINT, submitOnModEnter } from './styles.js';

export default function PersonalFields({ form, set, pastTags, tagInput, setTagInput }) {
  return (
    <div className="space-y-6">
      <div>
        <label className={label}>Rating</label>
        <StarRating
          value={form.rating}
          onChange={(v) => set('rating', v)}
          ariaLabel={form.title ? `Rating for ${form.title}` : 'Book rating'}
        />
        {form.rating && (
          <button
            type="button"
            aria-label={form.title ? `Clear rating for ${form.title}` : 'Clear book rating'}
            onClick={() => set('rating', null)}
            className="text-xs text-neutral-600 hover:text-neutral-400 mt-1.5"
          >
            Clear rating
          </button>
        )}
      </div>

      <ChipInput
        label="Tags"
        items={form.tags}
        onItemsChange={(items) => set('tags', items)}
        inputValue={tagInput}
        onInputChange={setTagInput}
        datalistId="tags-list"
        datalistOptions={pastTags}
        placeholder="Type a tag, press Enter or comma to add"
        inputClassName={input}
      />

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label htmlFor="book-notes" className={label} style={{marginBottom:0}}>Notes</label>
          <span className="text-xs text-neutral-600 cursor-help underline decoration-dotted decoration-neutral-700 underline-offset-2" title={MARKDOWN_HINT}>Markdown supported</span>
        </div>
        <MentionTextarea id="book-notes" className={`${input} resize-none`} rows={6}
          value={form.notes} onValue={(v) => set('notes', v)}
          onKeyDown={submitOnModEnter}
          placeholder="Your thoughts…  (@ to link a book)" />
      </div>

      {(form.status === 'finished' || form.read_count > 0) && (
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label htmlFor="book-review" className={label} style={{marginBottom:0}}>Review</label>
            <span className="text-xs text-neutral-600 cursor-help underline decoration-dotted decoration-neutral-700 underline-offset-2" title={MARKDOWN_HINT}>Markdown supported</span>
          </div>
          <MentionTextarea id="book-review" className={`${input} resize-none`} rows={8}
            value={form.review} onValue={(v) => set('review', v)}
            onKeyDown={submitOnModEnter}
            placeholder="Your review…  (@ to link a book)" />
        </div>
      )}
    </div>
  );
}
