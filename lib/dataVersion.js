// Global data-version beacon for cross-device cache staleness.
//
// Spine's client runs a local-first TanStack Query config (staleTime:
// Infinity, no focus refetch) on the premise that a single user never
// sees data changed behind their back. That premise holds per DEVICE,
// not per user: the phone (via Tailscale) and the PC each run their own
// browser, and BroadcastChannel doesn't cross devices. This counter
// gives clients a one-request way to ask "has anything been written
// since I last looked?" on tab focus, and refetch only when the answer
// is yes.
//
// In-memory on purpose — no persistence, no schema. The boot timestamp
// prefixes the counter so a server restart reads as a version change,
// which errs on the safe side: every client invalidates once after a
// restart rather than trusting a counter that reset to 0.

import db from '../db.js';

const boot = Date.now();
let counter = 0;

export function bumpDataVersion() {
  counter++;
}

// The counter only sees writes made through this server's HTTP API. The
// import / backfill / dedupe scripts write to spine.db through their own
// connection, so other devices never learned of those changes until a
// restart. SQLite's PRAGMA data_version on this connection changes
// whenever ANY OTHER connection commits — exactly the missing signal — so
// it's folded in. (This connection's own writes don't move it; the
// counter covers those. Read-only access such as the backups doesn't.)
export function getDataVersion() {
  return `${boot}-${counter}-${db.pragma('data_version', { simple: true })}`;
}
