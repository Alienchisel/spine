import { useId } from 'react';
import ShelfPicker from '../ShelfPicker.jsx';
import PartialDateInput from '../PartialDateInput.jsx';
import { input, label } from './styles.js';

export default function AcquisitionFields({ form, setForm, set, pastSources, shelfTree }) {
  const idPfx = useId();
  const idFor = (k) => `${idPfx}-${k}`;
  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        {!form.is_custom && (
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={form.owned}
              onChange={(e) => {
                const owned = e.target.checked;
                setForm(f => ({ ...f, owned, previously_owned: owned ? false : f.previously_owned, ...(!owned && { condition: '', shelf_id: null, building_id: null, room_id: null, unit_id: null }) }));
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
              setForm(f => ({ ...f, is_custom, owned: is_custom ? true : f.owned, ...(is_custom && { previously_owned: false, acquisition_source: '', acquisition_date: '' }) }));
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
            <label htmlFor={idFor('acquisition_source')} className={label}>Acquisition source</label>
            <input id={idFor('acquisition_source')} className={input} list="sources-list" value={form.acquisition_source}
              onChange={(e) => set('acquisition_source', e.target.value)}
              placeholder="e.g. Chapters, Amazon, gift…" />
            <datalist id="sources-list">
              {pastSources.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>

          <div>
            <label className={label}>Acquisition date</label>
            <PartialDateInput
              value={form.acquisition_date}
              onChange={v => set('acquisition_date', v)}
              ariaLabelPrefix="Acquisition"
            />
          </div>
        </>
      )}
    </div>
  );
}
