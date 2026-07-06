import { lazy, Suspense } from 'react';

// react-markdown (plus its micromark/remark dependency tree) is ~120 kB
// minified — too heavy for the entry chunk just because BookDetail is
// eager. The dynamic import inside lazy() keeps the whole stack in its
// own chunk, fetched the first time any markdown actually renders.
let mod;
const LazyReactMarkdown = lazy(() =>
  import('react-markdown').then((m) => { mod = m; return m; })
);

// urlTransform for [#NNN](spine-book:NNN) references: pass the custom
// scheme through, defer everything else to react-markdown's sanitiser
// (which would otherwise strip any scheme outside its http(s)/mailto/
// xmpp/irc(s) allow-list, leaving an empty href that reloads the page).
// Only ever invoked during LazyReactMarkdown's render, by which point
// the module has resolved and `mod` is set.
export const spineUrlTransform = (url) =>
  url.startsWith('spine-book:') ? url : mod.defaultUrlTransform(url);

export default function Markdown({ children, ...props }) {
  return (
    <Suspense fallback={null}>
      <LazyReactMarkdown {...props}>{children}</LazyReactMarkdown>
    </Suspense>
  );
}
