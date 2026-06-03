import { useEffect, useRef, useState } from 'react';
import { MOD_KEY } from '../../utils.js';
import { submitOnModEnter } from '../../components/bookForm/styles.js';
import ChipInput from '../../components/bookForm/ChipInput.jsx';
import { loadDraft, saveDraft } from './wizards.js';

// Text-mode wizard: focused input(s) + Save / Skip. Owns the per-card
// values/chipInputs state and the per-card focus-the-first-input effect
// so the orchestrator doesn't have to. People fields render a ChipInput
// with autocomplete from `suggestions` (fetched once when the wizard
// mounts, since a wizard's people fields don't change mid-session).
//
// Per-card drafts are persisted to localStorage on every keystroke
// (debounced 300ms) so closing the tab mid-bio doesn't lose work. On
// card mount we hydrate from the stored draft if one exists; otherwise
// we reset to empty. Drafts are cleared by the orchestrator on
// successful save and on Refresh pool — see wizards.js helpers.
const DRAFT_DEBOUNCE_MS = 300;

export default function TextModeForm({ cfg, wizardKey, current, busy, suggestions, onPick, onSkip }) {
  const [values, setValues] = useState({});
  const [chipInputs, setChipInputs] = useState({});
  const inputRef = useRef(null);

  // Reset (or hydrate from draft) on every card change so typing never
  // lands in a stale value. People fields default to an empty array
  // (committed chips) plus an empty chipInputs buffer (in-progress
  // text). Focus the first input so the keyboard-first flow keeps
  // working.
  useEffect(() => {
    const draft = current?.id != null ? loadDraft(wizardKey, current.id) : null;
    if (draft && draft.values && draft.chipInputs) {
      setValues(draft.values);
      setChipInputs(draft.chipInputs);
    } else {
      setValues(Object.fromEntries(cfg.fields.map(f => [f.name, f.type === 'people' ? [] : ''])));
      setChipInputs(Object.fromEntries(cfg.fields.filter(f => f.type === 'people').map(f => [f.name, ''])));
    }
    inputRef.current?.focus();
  }, [cfg, current?.id, wizardKey]);

  // Debounced draft persist. Re-armed every time values or chipInputs
  // change; only the final keystroke in a burst actually writes.
  // Trailing-edge semantics — instant feedback isn't useful here.
  useEffect(() => {
    if (current?.id == null) return undefined;
    const id = current.id;
    const t = setTimeout(() => {
      // Skip writing the empty-defaults blob; reduces clutter when the
      // user just clicks through cards without typing.
      const hasValueText = Object.values(values).some(v => Array.isArray(v) ? v.length > 0 : (v ?? '').trim());
      const hasChipText  = Object.values(chipInputs).some(v => (v ?? '').trim());
      if (!hasValueText && !hasChipText) return;
      saveDraft(wizardKey, id, { values, chipInputs });
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [values, chipInputs, wizardKey, current?.id]);

  // Cmd+Enter is the save shortcut whenever any field is multiline or
  // people-typed (textareas swallow plain Enter; ChipInputs commit a
  // chip on plain Enter). Pure plain-input wizards still take plain
  // Enter via native form submit.
  const needsModEnter = cfg.fields.some(f => f.multiline || f.type === 'people');
  // Save is enabled when any field has content. For people fields,
  // both committed chips and uncommitted input text count — submit
  // auto-commits the latter before sending.
  const anyFilled = cfg.fields.some(f => {
    if (f.type === 'people') {
      return (values[f.name]?.length > 0) || (chipInputs[f.name]?.trim());
    }
    return (values[f.name] ?? '').trim();
  });

  function handleSubmit(e) {
    e.preventDefault();
    // Build the payload from only the filled fields so a user who fills
    // birth but leaves death blank doesn't wipe death (or in single-
    // field wizards, sends exactly the field they edited).
    const payload = {};
    for (const f of cfg.fields) {
      if (f.type === 'people') {
        // Merge any uncommitted input text (split on commas, deduped)
        // into the committed chip list before sending — users frequently
        // type a name and click Save without hitting Enter.
        const existing = values[f.name] ?? [];
        const pending = (chipInputs[f.name] ?? '')
          .split(',').map(s => s.trim()).filter(Boolean);
        const merged = [...existing];
        for (const p of pending) {
          if (!merged.includes(p)) merged.push(p);
        }
        if (merged.length > 0) {
          payload[f.name] = merged.map(name => ({ name }));
        }
      } else {
        const v = (values[f.name] ?? '').trim();
        if (v) payload[f.name] = v;
      }
    }
    if (Object.keys(payload).length === 0) return;
    onPick(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {cfg.fields.map((f, i) => {
        if (f.type === 'people') {
          return (
            <ChipInput
              key={f.name}
              ref={i === 0 ? inputRef : null}
              label={f.label ?? f.name}
              items={values[f.name] ?? []}
              onItemsChange={items => setValues(v => ({ ...v, [f.name]: items }))}
              inputValue={chipInputs[f.name] ?? ''}
              onInputChange={s => setChipInputs(c => ({ ...c, [f.name]: s }))}
              datalistId={`wizard-${f.name}-list`}
              datalistOptions={suggestions?.[f.name] ?? []}
              placeholder={f.placeholder ?? 'Type a name, Enter or comma to add'}
              inputClassName="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 disabled:opacity-60"
            />
          );
        }
        const common = {
          ref: i === 0 ? inputRef : null,
          value: values[f.name] ?? '',
          onChange: e => setValues(v => ({ ...v, [f.name]: e.target.value })),
          placeholder: f.placeholder ?? '',
          'aria-label': `Set ${f.label || f.name} for ${cfg.getName(current)}`,
          disabled: busy,
        };
        return (
          <div key={f.name}>
            {f.label && <label className="block text-xs text-neutral-500 mb-1">{f.label}</label>}
            {f.multiline ? (
              <textarea
                {...common}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); onSkip(); return; }
                  submitOnModEnter(e);
                }}
                rows={6}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 disabled:opacity-60 resize-y"
              />
            ) : (
              <input
                {...common}
                type={f.type ?? 'text'}
                min={f.min}
                max={f.max}
                step={f.step}
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onSkip(); } }}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            )}
          </div>
        );
      })}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="submit"
          disabled={busy || !anyFilled}
          className="px-4 py-3 bg-oak hover:bg-leather disabled:opacity-60 disabled:cursor-not-allowed text-neutral-950 text-sm font-semibold rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak/60 flex flex-col items-center gap-1"
        >
          <span>Save</span>
          <span className="text-[10px] text-neutral-800">{needsModEnter ? `${MOD_KEY}+↵` : '↵'}</span>
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          aria-label={`Skip ${cfg.getName(current)}`}
          className="px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-60 text-neutral-400 hover:text-parchment text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 flex flex-col items-center gap-1"
        >
          <span>Skip</span>
          <span className="text-[10px] text-neutral-600">Esc</span>
        </button>
      </div>
    </form>
  );
}
