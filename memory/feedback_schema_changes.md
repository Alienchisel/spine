---
name: Schema changes require full stack updates
description: Every schema change must be accompanied by a migration file, updated route handlers, updated form state, and updated detail page display.
type: feedback
---

For every new field or schema change, always update all four layers:
1. **Migration** — new `.sql` file in `migrations/` with `ALTER TABLE` or new table
2. **Route** — destructure the field in both POST and PUT handlers, add to INSERT and UPDATE queries
3. **Form** — add to `EMPTY` state, load in edit `useEffect`, add input to JSX, parse correctly in submit payload
4. **Detail page** — display the field if present

**Why:** Fields added to the DB but missed in routes or the form silently store null. Fields missed on the detail page are invisible to the user. Easy to miss one layer during a quick change.

**How to apply:** Treat it as a checklist on every schema change — migration → routes → form → detail.
