import { Section, StatCard } from '../shared.jsx';

// Six-to-eight tile grid: the structural buckets of the catalogue
// (Owned / Prev. owned / Never owned / Finished / Reading / Unread)
// plus optional Loved and Custom when the user has populated them.
// Every tile is a Library filter link.
export default function LibraryTotals({ totals }) {
  return (
    <Section title="Library">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Owned"        value={totals.owned?.toLocaleString()}            href="/?tab=owned" />
        <StatCard label="Prev. owned"  value={totals.previously_owned?.toLocaleString()} href="/?tab=prev_owned" />
        <StatCard label="Never owned"  value={totals.never_owned?.toLocaleString()}      href="/?tab=never_owned" />
        <StatCard label="Finished"     value={totals.finished?.toLocaleString()}         href="/?tab=finished" />
        <StatCard label="Reading"      value={totals.reading?.toLocaleString()}          href="/?tab=reading" />
        <StatCard label="Unread"       value={totals.unread?.toLocaleString()}           href="/?tab=unread" />
        {totals.loved > 0  && <StatCard label="Loved"  value={totals.loved?.toLocaleString()}  href="/loved" />}
        {totals.custom > 0 && <StatCard label="Custom" value={totals.custom?.toLocaleString()} href="/?tab=all&custom=true" />}
      </div>
    </Section>
  );
}
