import ChipInput from './ChipInput.jsx';
import ConditionGuide from './ConditionGuide.jsx';
import { input, inputNoWidth, label } from './styles.js';

export default function CoreFields({
  form, setForm, set, ic, isEdit,
  pastAuthors, pastSeries, pastNarrators,
  authorInput,   setAuthorInput,
  narratorInput, setNarratorInput,
  durationH, setDurationH,
  durationM, setDurationM,
}) {
  return (
    <div className="space-y-6">
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
        <label className={label}>Title *</label>
        <input className={ic('title')} value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Book title" required autoFocus={!isEdit} />
      </div>

      <ChipInput
        label="Authors"
        items={form.authors}
        onItemsChange={(items) => set('authors', items)}
        inputValue={authorInput}
        onInputChange={setAuthorInput}
        datalistId="authors-list"
        datalistOptions={pastAuthors}
        placeholder="Type a name, press Enter or comma to add"
        inputClassName={ic('authors')}
      />

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

      <div>
        <label className={label}>Status</label>
        <select className={input} value={form.status}
          onChange={(e) => {
            const s = e.target.value;
            const today = new Date().toLocaleDateString('en-CA');
            setForm(f => ({
              ...f,
              status: s,
              read_count: s === 'finished' && f.read_count === 0 ? 1 : f.read_count,
              date_started: s === 'reading' && !f.date_started ? today : f.date_started,
              // Skip the today-default on previously-owned books — typically
              // a historical read with an unknown date; auto-filling today
              // silently fabricates one. Leaves the date blank instead.
              date_finished: s === 'finished' && !f.date_finished && !f.previously_owned ? today : f.date_finished,
            }));
          }}>
          <option value="unread">Unread</option>
          <option value="reading">Reading</option>
          <option value="finished">Finished</option>
        </select>
      </div>

      {(form.status === 'reading' || form.status === 'finished') && (
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
          <ChipInput
            label="Narrators"
            items={form.narrators}
            onItemsChange={(items) => set('narrators', items)}
            inputValue={narratorInput}
            onInputChange={setNarratorInput}
            datalistId="narrators-list"
            datalistOptions={pastNarrators}
            placeholder="Type a name, press Enter or comma to add"
            inputClassName={input}
          />
        </>
      )}
    </div>
  );
}
