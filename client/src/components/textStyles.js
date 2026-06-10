// Canonical section-eyebrow typography. Use this for the small-caps
// labels that introduce sections within a page ("Books", "Authors",
// "Acquisition", a day-header date, a shelf label). Caller composes
// layout (margins, borders, flex) on top.
//
// Intentional non-users (designed variants — don't converge without a
// design call):
//   - Audit.jsx and Author.jsx use a slightly smaller/lighter eyebrow
//     (text-[11px] font-medium tracking-wider) for denser screens with
//     many section breaks — the recessive size keeps the headers from
//     stacking too loud.
//   - Readlist.jsx uses a slab variant (font-slab text-xs tracking-wider)
//     to match the page's slab+no-uppercase page title — the eyebrow
//     and the page heading share family on that surface.
//   - Stats.jsx Section helper uses text-neutral-600 + tracking-wider
//     (one shade darker, slightly tighter) — Stats has so many section
//     headers that a quieter eyebrow keeps the chrome out of the way.
export const sectionEyebrow = 'text-xs font-semibold text-neutral-500 uppercase tracking-widest';
