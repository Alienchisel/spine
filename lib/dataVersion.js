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

const boot = Date.now();
let counter = 0;

export function bumpDataVersion() {
  counter++;
}

export function getDataVersion() {
  return `${boot}-${counter}`;
}
