import db from '../../db.js';

// Counts and groupings over the books table. None of these depend on
// reading_log activity — they describe the shape of the catalogue at rest.
export function getInventoryStats() {
  // "Owned" means "I have a copy I can read", regardless of how it was
  // acquired — purchased, side-loaded from the open web, or user-assembled.
  // Provenance lives on acquisition_source (Amazon / Kindle / Audible /
  // Internet / Gift / etc.) and is_custom; queries that want the narrower
  // "purchased media" view can add those predicates explicitly. Mirrors
  // the Library Owned tab and /api/books/counts.owned so Stats and
  // Library never disagree.
  //
  // Every count here that feeds a StatCard linking to a Library tab
  // (owned / prev_owned / reading / finished / unread / loved) excludes
  // archived, because those tabs exclude archived by default (see
  // buildFilterConditions in lib/books/filters.js). Without it, archiving
  // an owned book makes Stats over-count relative to the tab it links to.
  // `books = COUNT(*)` is deliberately the whole-DB grand total. The
  // ownedFilter constant carries the archived exclusion so the three
  // owned-scoped breakdowns below (formats / fiction / ownedStatus)
  // reconcile with the owned total.
  const active = "COALESCE(archived,0) = 0";
  const ownedFilter = `owned = 1 AND ${active}`;
  const totals = db.prepare(`
    SELECT
      COUNT(*)                          AS books,
      SUM(${ownedFilter})               AS owned,
      SUM(previously_owned = 1 AND ${active}) AS previously_owned,
      SUM(owned = 0
          AND COALESCE(previously_owned,0) = 0
          AND COALESCE(is_custom,0) = 0
          AND ${active})                 AS never_owned,
      SUM(is_custom = 1
          AND ${active})                 AS custom,
      SUM(status = 'reading'  AND ${active}) AS reading,
      SUM(status = 'finished' AND ${active}) AS finished,
      SUM(status = 'unread'   AND ${active}) AS unread,
      SUM(loved = 1 AND ${active})       AS loved
    FROM books
  `).get();

  const formats = db.prepare(`
    SELECT format, COUNT(*) AS count FROM books
    WHERE ${ownedFilter}
    GROUP BY format ORDER BY count DESC
  `).all();

  const fiction = db.prepare(`
    SELECT
      SUM(fiction = 1)     AS fiction,
      SUM(fiction = 0)     AS nonfiction,
      SUM(fiction IS NULL) AS unset
    FROM books WHERE ${ownedFilter}
  `).get();

  const ownedStatus = db.prepare(`
    SELECT
      SUM(status = 'reading')  AS reading,
      SUM(status = 'finished') AS finished,
      SUM(status = 'unread')   AS unread
    FROM books WHERE ${ownedFilter}
  `).get();

  const ratings = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM books WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating DESC
  `).all();

  // Acquisition source breakdown over books currently in the library
  // (owned=1, archived excluded). Bucketed into a small fixed taxonomy so
  // the donut stays readable: Kindle / Audible / Internet are digital
  // distribution lanes; Amazon is the dominant physical retailer and
  // earns its own slice; everything else (Book Outlet, AbeBooks, Gift,
  // used bookstores, etc.) collapses into Other; NULL/empty into Unknown.
  // Includes Internet-sourced rows even though Owned counts above exclude
  // them — this chart's purpose is "where does my library come from",
  // which is the one place that distinction is the actual subject.
  const acquisitionSources = db.prepare(`
    SELECT
      SUM(acquisition_source = 'Kindle')                                                      AS kindle,
      SUM(acquisition_source = 'Audible')                                                     AS audible,
      SUM(acquisition_source = 'Internet')                                                    AS internet,
      SUM(acquisition_source = 'Amazon')                                                      AS amazon,
      SUM(acquisition_source IS NOT NULL AND acquisition_source != ''
          AND acquisition_source NOT IN ('Kindle','Audible','Internet','Amazon'))             AS other,
      SUM(acquisition_source IS NULL OR acquisition_source = '')                              AS unknown
    FROM books
    WHERE owned = 1 AND COALESCE(archived,0) = 0
  `).get();

  return { totals, formats, fiction, ownedStatus, ratings, acquisitionSources };
}
