// Canonical page-title typography: slab serif, parchment, uppercase, wide
// tracking. Renders the h1 with the agreed shape. Caller controls
// surrounding layout (margin, flex containers for adjacent action
// elements) — this component is typography-only by design.
//
// Intentional non-users:
//   - BookDetail: the h1 is a book title, not a page name (text-4xl
//     tracking-tight, no uppercase — uppercasing book titles reads wrong)
//   - Author, BrowsePage: the h1 is a dynamic proper noun (author name,
//     tag/series target) — same uppercase-reads-wrong rationale
//   - Readlist, Notes: deliberate alt aesthetic — slab + parchment but
//     larger (text-3xl) and no uppercase, for pages where the title is
//     the focal content rather than a section label
//
// Section-eyebrow h2s ("Acquisition", "Activity", etc.) are a different
// role and use a separate small-caps pattern that hasn't been unified
// into a component yet.
export default function PageHeading({ children }) {
  return (
    <h1 className="font-slab text-2xl text-parchment uppercase tracking-wider">
      {children}
    </h1>
  );
}
