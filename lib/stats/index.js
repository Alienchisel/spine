// Composer for the GET /api/stats response.
//
// Each section file (inventory.js, activity.js, people.js, catalogue.js,
// records.js) exports a single function that returns its slice of the stats
// object. Section outputs are flat-spread into the response, except records,
// which is nested under the `records` key.
//
// To add a new stat:
//   - to an existing section: open the matching file, add a SQL query, return
//     it under a new key.
//   - in a new category: create a new file under lib/stats/ that exports a
//     function returning { ... }, then spread it here.
//   - new "biggest/oldest/etc." book: one line in records.js.
//
// Each section is independently importable for testing or for future
// per-section endpoints. Audit is already split out — it scans the books
// table with ~40 SUM(CASE) expressions and is only read by /audit, so it
// lives behind GET /api/stats/audit rather than riding every Stats page
// load. See lib/stats/audit.js + routes/stats.js for the dedicated path.

import { getInventoryStats } from './inventory.js';
import { getActivityStats } from './activity.js';
import { getPeopleStats } from './people.js';
import { getCatalogueStats } from './catalogue.js';
import { getRecords } from './records.js';

export function computeAllStats() {
  return {
    ...getInventoryStats(),
    ...getActivityStats(),
    ...getPeopleStats(),
    ...getCatalogueStats(),
    records: getRecords(),
  };
}
