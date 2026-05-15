import { useState, useRef } from 'react';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { useEscapeKey } from '../hooks/useEscapeKey.js';

export default function SearchHelp() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useClickOutside(wrapperRef, () => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Search syntax help"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Search syntax help"
        className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm transition-colors ${
          open ? 'bg-binding/25 text-parchment' : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
        }`}
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Search syntax"
          className="absolute right-0 top-full mt-2 z-20 w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-300 shadow-xl"
        >
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Search syntax</p>
          <dl className="space-y-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-3">
              <code className="text-oak whitespace-nowrap">word word</code>
              <span className="text-neutral-400">match both (AND, default)</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3">
              <code className="text-oak whitespace-nowrap">word OR word</code>
              <span className="text-neutral-400">match either (uppercase OR)</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3">
              <code className="text-oak whitespace-nowrap">"exact phrase"</code>
              <span className="text-neutral-400">literal substring match</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3">
              <code className="text-oak whitespace-nowrap">-word</code>
              <span className="text-neutral-400">exclude (also <code className="text-oak">NOT word</code>)</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3">
              <code className="text-oak whitespace-nowrap">(a OR b) c</code>
              <span className="text-neutral-400">group sub-expressions</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3">
              <code className="text-oak whitespace-nowrap">author:vance</code>
              <span className="text-neutral-400">pin to one surface</span>
            </div>
          </dl>
          <p className="text-xs text-neutral-600 mt-3 leading-relaxed">
            Bare terms match across title, series, tags, authors, narrators,
            and translators. Qualifiers <code className="text-neutral-500">title:</code>{' '}
            <code className="text-neutral-500">series:</code>{' '}
            <code className="text-neutral-500">tag:</code>{' '}
            <code className="text-neutral-500">author:</code>{' '}
            <code className="text-neutral-500">narrator:</code>{' '}
            <code className="text-neutral-500">translator:</code>{' '}
            <code className="text-neutral-500">publisher:</code>{' '}
            <code className="text-neutral-500">list:</code> pin to a
            single surface, and accept quoted values:{' '}
            <code className="text-neutral-500">series:"New Sun"</code>.{' '}
            <code className="text-neutral-500">or</code> and{' '}
            <code className="text-neutral-500">not</code> in lowercase are
            treated as literal words.
          </p>
        </div>
      )}
    </div>
  );
}
