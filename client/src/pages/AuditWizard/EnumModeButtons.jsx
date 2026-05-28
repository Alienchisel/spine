// Enum-mode wizard: a button per cfg.options value plus Skip. Number-row
// keyboard shortcuts (1..N) live in the orchestrator's window-level
// listener — this component renders only.
export default function EnumModeButtons({ cfg, current, busy, onPick, onSkip }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cfg.options.map((opt, i) => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onPick(opt.value)}
          disabled={busy}
          aria-label={`Set ${cfg.field} for ${cfg.getName(current)} to ${opt.label}`}
          className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-wait text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
        >
          <span>{opt.label}</span>
          <span className="text-[10px] text-neutral-500">{i === 9 && cfg.options.length === 10 ? '0' : i + 1}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        aria-label={`Skip ${cfg.getName(current)}`}
        className="px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-400 hover:text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
      >
        <span>Skip</span>
        <span className="text-[10px] text-neutral-600">S</span>
      </button>
    </div>
  );
}
