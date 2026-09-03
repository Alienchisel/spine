// Returns a `req` bound to a base URL. Each test file's before() got
// 1.224.1 lifted this duplicated helper out of 17 in-file copies.
// Caller convention is the same shape the local copies were:
//   const { status, body } = await req('GET', '/api/books', undefined);
// 204 No Content responses come back with body=null instead of
// crashing in JSON.parse, matching the original local helpers'
// behaviour.
// Empty every data table on the shared in-memory DB, giving the next test a
// clean slate. This is the ONLY real isolation mechanism within a test file:
// createTestServer() imports the ESM-cached app.js, so calling it twice hands
// back the SAME module-singleton DB connection (db.js opens it once at import)
// — a second server does NOT isolate. Use this in a beforeEach for suites that
// need each test to see only its own fixtures (e.g. today-card cohort
// selection, where accumulated fixtures shift which card wins the date seed).
//
// Preserves schema (and schema_migrations / sqlite_sequence, so ids keep
// climbing and never collide across resets). FK enforcement is toggled OFF
// around the wipe so table order doesn't matter — and the pragma is set
// OUTSIDE the transaction, since SQLite silently ignores PRAGMA foreign_keys
// inside an open transaction.
export async function resetDb() {
  const db = (await import('../db.js')).default;
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'"
  ).all().map(r => r.name);
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const t of tables) db.exec(`DELETE FROM "${t}"`);
  })();
  db.pragma('foreign_keys = ON');
}

export function makeReq(url) {
  return async function req(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    // Parse the body defensively. The old `res.json()` call assumed every
    // non-204 response carried valid JSON — but an unhandled server `throw`
    // reaches Express's default error handler and returns an HTML 500, and
    // some handlers return an empty-body 200/304. res.json() then throws
    // `SyntaxError: Unexpected end of JSON input`, killing the test with an
    // opaque parser crash that MASKS the real failure (the 500). Read the
    // raw text once and parse it only when it's actually JSON: an empty
    // body → null (preserves the old 204 behaviour), a non-JSON body →
    // returned verbatim as a string, so `assert.equal(status, …)` can
    // report the true failure instead of a parser stack trace.
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = text; }
    }
    return { status: res.status, body: data };
  };
}

// Returns the { url, close, req } trio each integration test file
// needs to spin up an isolated in-memory test server. `req` is the
// shared makeReq()-bound helper so callers don't have to re-declare
// the same JSON fetch wrapper file by file.
export async function createTestServer() {
  process.env.DB_PATH = ':memory:';
  // Pin the Today-card future-date guard's clock beyond every sweep
  // fixture in the suite (2026-11, 2027-03, 2027-10, …) so those
  // tests keep exercising the persistence path. Requests dated past
  // THIS value hit the guard — the future-guard regression test uses
  // a 2031 date deliberately.
  process.env.TODAY_NOW_OVERRIDE = '2030-01-01';
  const { default: app } = await import('../app.js');

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const url = `http://localhost:${port}`;
      resolve({
        url,
        close: () => new Promise((r) => server.close(r)),
        req: makeReq(url),
      });
    });
  });
}
