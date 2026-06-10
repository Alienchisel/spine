// Canonical page-title typography: slab serif, parchment, uppercase, wide
// tracking. Renders the h1 with the agreed shape so the 17 hand-rolled
// page titles can converge over time. Caller controls surrounding layout
// (margin, flex containers for adjacent action elements) — this component
// is typography-only by design.
//
// Not for the BookDetail book title or the section-eyebrow h2s — those
// are different roles. This is the "name of this section of the app"
// header that sits at the top of every top-level page.
export default function PageHeading({ children }) {
  return (
    <h1 className="font-slab text-2xl text-parchment uppercase tracking-wider">
      {children}
    </h1>
  );
}
