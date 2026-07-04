#!/bin/sh
# Headless route smoke test.
#
# Loads every client route in headless chromium and fails if any of
# them renders the RouteError boundary ("Something went wrong on this
# page") or comes back empty. This catches the class of render-time
# crash that neither `npm run check` (server-side tests) nor the Vite
# build can see — e.g. the 1.256.1 ListDetail TDZ crash, where a
# query-derived const was referenced in a useMemo dep array above its
# declaration: legal syntax, clean build, every /lists/:id visit dead.
#
# Needs the dev stack up (vite on 5173, API on 3001) — or point the
# env vars at a production instance:
#
#   SPINE_CLIENT_URL=http://localhost:3001 scripts/smoke-routes.sh
#
# Dynamic route segments (book/author/list ids, a browse value) are
# pulled from the live API so the script doesn't rot as data changes.

BASE="${SPINE_CLIENT_URL:-http://localhost:5173}"
API="${SPINE_API_URL:-http://localhost:3001}"
CHROME="${CHROME:-chromium}"

pyjson() { python3 -c "import sys, json; $1" 2>/dev/null; }

BOOK_ID=$(curl -s "$API/api/books?limit=1" | pyjson "print(json.load(sys.stdin)['books'][0]['id'])")
AUTHOR_ID=$(curl -s "$API/api/authors" | pyjson "print(json.load(sys.stdin)[0]['id'])")
LIST_ID=$(curl -s "$API/api/lists" | pyjson "print(json.load(sys.stdin)[0]['id'])")
BROWSE=$(curl -s "$API/api/books?limit=1" | pyjson "
import urllib.parse
b = json.load(sys.stdin)['books'][0]
print('publisher/' + urllib.parse.quote(b['publisher']) if b.get('publisher') else '')")

if [ -z "$BOOK_ID" ] || [ -z "$AUTHOR_ID" ] || [ -z "$LIST_ID" ]; then
  echo "FATAL: could not fetch seed ids from $API — is the server up?" >&2
  exit 2
fi

ROUTES="/
/books/$BOOK_ID
/books/new
/authors
/authors/$AUTHOR_ID
/tags
/series
/readlist
/loved
/lists
/lists/$LIST_ID
/diary
/today
/notes
/stats
/collage
/audit
/audit/wizard/critical
/data-viz
/shelf
/shelf-view"
[ -n "$BROWSE" ] && ROUTES="$ROUTES
/browse/$BROWSE"

fails=0
for r in $ROUTES; do
  out=$("$CHROME" --headless --disable-gpu --dump-dom --virtual-time-budget=8000 "$BASE$r" 2>/dev/null)
  if echo "$out" | grep -q 'Something went wrong on this page'; then
    echo "CRASH  $r"
    echo "$out" | grep -o 'Developer details[^<]*' | head -1
    echo "$out" | grep -o "can't access[^<]*" | head -1
    fails=$((fails + 1))
  elif [ -z "$out" ]; then
    echo "EMPTY  $r"
    fails=$((fails + 1))
  else
    echo "ok     $r"
  fi
done

if [ "$fails" -gt 0 ]; then
  echo "$fails route(s) failed" >&2
  exit 1
fi
echo "all routes render"
