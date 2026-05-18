// One-off: strip the leading date parenthetical from every authors.bio row.
// Reuses the same stripBioDates helper that fetchAuthorDetails now applies
// on incoming OL fetches, so future OL fetches and the existing DB stay in
// the same shape.
//
// Run with: node scripts/strip-bio-dates.js
// Add --apply to write; without it, prints a dry-run diff.

import db from '../db.js';
import { stripBioDates } from '../lib/authors/openLibrary.js';

const apply = process.argv.includes('--apply');
const rows  = db.prepare('SELECT id, name, bio FROM authors WHERE bio IS NOT NULL ORDER BY id').all();

let changed = 0;
const update = db.prepare('UPDATE authors SET bio = ? WHERE id = ?');
for (const r of rows) {
  const cleaned = stripBioDates(r.bio);
  if (cleaned === r.bio) continue;
  changed++;
  const oldHead = r.bio.slice(0, 140).replace(/\n/g, ' ');
  const newHead = (cleaned || '').slice(0, 140).replace(/\n/g, ' ');
  console.log(`#${r.id} ${r.name}`);
  console.log(`  OLD: ${oldHead}`);
  console.log(`  NEW: ${newHead}`);
  console.log();
  if (apply) update.run(cleaned, r.id);
}
console.log(`${rows.length} bios scanned; ${changed} ${apply ? 'updated' : 'would change'}.`);
if (!apply) console.log('Re-run with --apply to write changes.');
