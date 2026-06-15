import { formatPartialDate } from '../../../utils.js';
import { Section, RecordCard, formatHours, editionRecordValue } from '../shared.jsx';

const subhead = 'text-[11px] font-semibold text-neutral-700 uppercase tracking-wider mb-2';
const subgrid = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3';

// One four-card row of records under a format-named sub-heading. Each
// card renders only when its book exists; pass null for absent slots
// and the row collapses to whatever is present.
function RecordGroup({ heading, cards }) {
  if (cards.every(c => !c.book)) return null;
  return (
    <div>
      <h3 className={subhead}>{heading}</h3>
      <div className={subgrid}>
        {cards.map((c, i) => c.book && <RecordCard key={i} label={c.label} book={c.book} value={c.value} />)}
      </div>
    </div>
  );
}

// "Records" — biggest / smallest / oldest / newest / first / last / most-reread
// books, grouped by format. Renders nothing when no record is populated.
export default function Records({ records }) {
  if (!records || !Object.values(records).some(Boolean)) return null;
  const pages = b => b ? `${b.page_count.toLocaleString()} pages` : null;
  return (
    <Section title="Records">
      <div className="space-y-5">
        <RecordGroup heading="Physical" cards={[
          { label: 'Longest read',        book: records.longestReadPhysical,     value: pages(records.longestReadPhysical) },
          { label: 'Shortest read',       book: records.shortestReadPhysical,    value: pages(records.shortestReadPhysical) },
          { label: 'Longest in library',  book: records.longestLibraryPhysical,  value: pages(records.longestLibraryPhysical) },
          { label: 'Shortest in library', book: records.shortestLibraryPhysical, value: pages(records.shortestLibraryPhysical) },
        ]} />
        <RecordGroup heading="Digital" cards={[
          { label: 'Longest read',        book: records.longestReadDigital,     value: pages(records.longestReadDigital) },
          { label: 'Shortest read',       book: records.shortestReadDigital,    value: pages(records.shortestReadDigital) },
          { label: 'Longest in library',  book: records.longestLibraryDigital,  value: pages(records.longestLibraryDigital) },
          { label: 'Shortest in library', book: records.shortestLibraryDigital, value: pages(records.shortestLibraryDigital) },
        ]} />
        <RecordGroup heading="Audiobook" cards={[
          { label: 'Longest read',        book: records.longestReadAudiobook,     value: formatHours(records.longestReadAudiobook?.duration_minutes) },
          { label: 'Shortest read',       book: records.shortestReadAudiobook,    value: formatHours(records.shortestReadAudiobook?.duration_minutes) },
          { label: 'Longest in library',  book: records.longestLibraryAudiobook,  value: formatHours(records.longestLibraryAudiobook?.duration_minutes) },
          { label: 'Shortest in library', book: records.shortestLibraryAudiobook, value: formatHours(records.shortestLibraryAudiobook?.duration_minutes) },
        ]} />
        {/* Records are ranked by COALESCE(year_edition, year_published) per
            lib/stats/records — display the same year, with a label that
            reflects which one was actually used so a 2020 reprint of a
            17th-c. work doesn't show "1600" next to "Newest edition." */}
        <RecordGroup heading="Edition" cards={[
          { label: 'Oldest edition', book: records.oldestEdition, value: editionRecordValue(records.oldestEdition) },
          { label: 'Newest edition', book: records.newestEdition, value: editionRecordValue(records.newestEdition) },
        ]} />
        <RecordGroup heading="Reading" cards={[
          { label: 'First finished', book: records.firstFinished, value: formatPartialDate(records.firstFinished?.date_finished) },
          { label: 'Last finished',  book: records.lastFinished,  value: formatPartialDate(records.lastFinished?.date_finished) },
          { label: 'Most re-read',   book: records.mostReread,    value: records.mostReread?.read_count ? `${records.mostReread.read_count} times` : null },
        ]} />
      </div>
    </Section>
  );
}
