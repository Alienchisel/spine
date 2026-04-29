export default function DragHandle({ listeners }) {
  return (
    <button
      type="button"
      {...listeners}
      className="text-neutral-700 hover:text-neutral-400 transition-colors cursor-grab active:cursor-grabbing flex-shrink-0 px-0.5"
      aria-label="Drag to reorder"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
        <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
      </svg>
    </button>
  );
}
