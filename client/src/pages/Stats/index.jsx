import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useFreshFetch } from '../../hooks/useFreshFetch.js';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import { FROM_STATS } from './shared.jsx';
import Hero from './sections/Hero.jsx';
import CurrentlyReading from './sections/CurrentlyReading.jsx';
import Goals from './sections/Goals.jsx';
import Streaks from './sections/Streaks.jsx';
import LibraryTotals from './sections/LibraryTotals.jsx';
import LibraryBreakdown from './sections/LibraryBreakdown.jsx';
import DecadesPublished from './sections/DecadesPublished.jsx';
import Languages from './sections/Languages.jsx';
import ReadingAverages from './sections/ReadingAverages.jsx';
import DaysReadPerMonth from './sections/DaysReadPerMonth.jsx';
import FinishedByYear from './sections/FinishedByYear.jsx';
import AcquiredByYear from './sections/AcquiredByYear.jsx';
import Records from './sections/Records.jsx';
import BarsGrid from './sections/BarsGrid.jsx';

// Top-level Stats page composer. Reads /api/stats once, then hands each
// slice to its dedicated section component. Sections are deliberately
// self-gating — they render nothing when their data slice is empty so
// the composer here doesn't have to know about every section's empty
// condition. Add a new section: drop a file under sections/, import it,
// place it in the render tree.
export default function Stats() {
  const { data: stats, loading, error, setError } = useFreshFetch(() => api.getStats(), []);

  // Only replace the whole page when there's no data to show. Once stats
  // are loaded, a subsequent refresh-tick failure surfaces as a dismissible
  // banner above the existing data rather than wiping it — mirrors
  // ShelfView's pattern.
  if (!stats && error) return <div role="alert" className="text-warn text-sm">Failed to load stats.</div>;
  if (loading) return null;

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between gap-4">
        <PageHeading>Stats</PageHeading>
        <Link to="/collage" state={FROM_STATS} className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors">
          Reading collage →
        </Link>
      </div>

      <ErrorBanner message={error ? 'Failed to load stats.' : null} onDismiss={() => setError(null)} />

      <Hero
        totals={stats.totals}
        authorsByGender={stats.authorsByGender}
        pagesRead={stats.pagesRead}
        minutesListened={stats.minutesListened}
        streaks={stats.streaks}
      />
      <CurrentlyReading inProgressPace={stats.inProgressPace} />
      <Goals
        todayPages={stats.todayPages}
        thisYearPages={stats.thisYearPages}
        thisYearBooks={stats.thisYearBooks}
      />
      <Streaks streaks={stats.streaks} />
      <LibraryTotals totals={stats.totals} />
      <LibraryBreakdown
        fiction={stats.fiction}
        formats={stats.formats}
        ownedStatus={stats.ownedStatus}
        acquisitionSources={stats.acquisitionSources}
        topTags={stats.topTags}
      />
      <DecadesPublished decadesPublished={stats.decadesPublished} />
      <Languages languages={stats.languages} />
      <ReadingAverages
        avgPagesPerDay={stats.avgPagesPerDay}
        avgDaysToFinish={stats.avgDaysToFinish}
      />
      <DaysReadPerMonth byMonth={stats.byMonth} />
      <FinishedByYear byYear={stats.byYear} />
      <AcquiredByYear acquiredByYear={stats.acquiredByYear} />
      <Records records={stats.records} />
      <BarsGrid
        ratings={stats.ratings}
        topAuthors={stats.topAuthors}
        topLovedAuthors={stats.topLovedAuthors}
        topNarrators={stats.topNarrators}
        topSeries={stats.topSeries}
        authorsByGender={stats.authorsByGender}
      />
    </div>
  );
}
