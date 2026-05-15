import { useRef } from 'react';

// Returns a ref whose `.current` always reflects the most recent value
// passed in. Useful inside async callbacks that need to read the latest
// state without re-attaching listeners or re-creating closures. The
// idiomatic alternative is `const ref = useRef(v); ref.current = v;` —
// this hook just gives the idiom a name and saves the assignment line.
//
// Mutation happens during render (write-only, no subscription) so
// dependent consumers won't re-render when the value changes — use plain
// state for that. Reads from event handlers, async resolutions, and
// other post-commit closures are the intended use case.
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
