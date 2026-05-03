import ShelfPicker from '../ShelfPicker.jsx';
import { input, inputNoWidth, label } from './styles.js';

export default function AcquisitionFields({ form, setForm, set, pastSources, shelfTree }) {
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
  );
}
