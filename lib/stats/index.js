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
// per-section endpoints (e.g., GET /api/stats/activity).

import { getInventoryStats } from './inventory.js';
import { getActivityStats } from './activity.js';
import { getPeopleStats } from './people.js';
import { getCatalogueStats } from './catalogue.js';
import { getRecords } from './records.js';
import { getAudit } from './audit.js';

export function computeAllStats() {
  return {
    ...getInventoryStats(),
    ...getActivityStats(),
    ...getPeopleStats(),
    ...getCatalogueStats(),
    ...getAudit(),
    records: getRecords(),
  };
}
