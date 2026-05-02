#!/usr/bin/env node
// Usage: node ingest.js <amazon-url-or-isbn>

import readline from 'readline';
import https from 'https';
import http from 'http';
import { saveCoverFromBuffer } from './lib/books/covers.js';

const API_BASE = process.env.SPINE_URL || 'http://localhost:3001';

const LANG_MAP = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', zh: 'Chinese',
  ko: 'Korean', ar: 'Arabic', pl: 'Polish', sv: 'Swedish', no: 'Norwegian',
  da: 'Danish', fi: 'Finnish', tr: 'Turkish', cs: 'Czech', hu: 'Hungarian',
};

function parseInput(raw) {
  const input = raw.trim();
  const asinMatch = input.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  if (asinMatch) return { type: 'asin', value: asinMatch[1].toUpperCase() };
  const clean = input.replace(/[-\s]/g, '');
  if (/^\d{13}$/.test(clean)) return { type: 'isbn13', value: clean };
  if (/^[0-9X]{10}$/i.test(clean)) return { type: 'isbn10', value: clean.toUpperCase() };
  throw new Error(`Couldn't parse as Amazon URL or ISBN: ${input}`);
}

function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 spine-ingest/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    }).on('error', reject);
  });
}

async function fetchGoogleBooks(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`;
  const { status, body } = await get(url);
  if (status !== 200) return null;
  const data = JSON.parse(body.toString());
  if (!data.items?.length) return null;
  const v = data.items[0].volumeInfo;
  const ids = v.industryIdentifiers || [];
  const coverUrl = v.imageLinks?.extraLarge || v.imageLinks?.large ||
                   v.imageLinks?.medium || v.imageLinks?.thumbnail || null;
  return {
    title:        v.title || '',
    authors:      v.authors || [],
    publisher:    v.publisher || '',
    year:         v.publishedDate ? parseInt(v.publishedDate) : null,
    description:  v.description || '',
    page_count:   v.pageCount || null,
    language:     LANG_MAP[v.language] || v.language || '',
    isbn_13:      ids.find(i => i.type === 'ISBN_13')?.identifier || '',
    isbn_10:      ids.find(i => i.type === 'ISBN_10')?.identifier || '',
    cover_url:    coverUrl ? coverUrl.replace('&edge=curl', '').replace(/zoom=\d+/, 'zoom=0') : null,
  };
}

async function fetchOpenLibrary(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const { status, body } = await get(url);
  if (status !== 200) return null;
  const data = JSON.parse(body.toString());
  const item = data[`ISBN:${isbn}`];
  if (!item) return null;
  return {
    title:       item.title || '',
    authors:     item.authors?.map(a => a.name) || [],
    publisher:   item.publishers?.[0]?.name || '',
    year:        item.publish_date ? parseInt(item.publish_date) : null,
    description: typeof item.description === 'object' ? item.description.value : (item.description || ''),
    page_count:  item.number_of_pages || null,
    language:    '',
    isbn_13:     item.identifiers?.isbn_13?.[0] || '',
    isbn_10:     item.identifiers?.isbn_10?.[0] || '',
    cover_url:   item.cover?.large || item.cover?.medium || null,
  };
}

async function downloadCover(url) {
  const { status, body } = await get(url);
  if (status !== 200 || body.length < 1000) return null;
  // Defer to the app's shared writer: magic-byte format detection,
  // automatic WebP→JPG conversion, safe-shape filename.
  try {
    const filename = await saveCoverFromBuffer(body);
    return `/uploads/${filename}`;
  } catch {
    return null;
  }
}

const STATUS_EXPAND   = { u: 'unread', r: 'reading', f: 'finished', p: 'paused' };
const FORMAT_EXPAND   = { p: 'physical', d: 'digital', a: 'audiobook' };
const BINDING_EXPAND  = { h: 'hardcover', p: 'paperback' };
const CONDITION_EXPAND = { n: 'new', f: 'fine', v: 'very good', g: 'good', a: 'fair', po: 'poor', p: 'poor' };

function expand(map, val) {
  return map[val.toLowerCase()] || val;
}


function ask(rl, label, def) {
  return new Promise(resolve => {
    rl.question(def ? `  ${label} [${def}]: ` : `  ${label}: `, ans => {
      resolve(ans.trim() || def || '');
    });
  });
}

function askMultiline(rl, label, def) {
  return new Promise(resolve => {
    const hint = def ? ` [existing — paste to replace, . to keep, Enter . to finish]` : ` (paste, then enter . on its own line to finish)`;
    console.log(`  ${label}${hint}:`);
    const lines = [];
    function onLine(line) {
      if (line === '.') {
        rl.removeListener('line', onLine);
        const result = lines.join('\n').trim();
        resolve(result || def || '');
      } else {
        lines.push(line.trim());
      }
    }
    rl.on('line', onLine);
  });
}

async function postBook(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const u = new URL('/api/books', API_BASE);
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node ingest.js <amazon-url-or-isbn>');
    process.exit(1);
  }

  let meta, parsed = null;

  parsed = parseInput(input);
  const lookupId = parsed.value;
  const typeLabel = { isbn13: 'ISBN-13', isbn10: 'ISBN-10', asin: 'ASIN' }[parsed.type];
  console.log(`\nLooking up ${typeLabel} ${lookupId}...\n`);

  meta = await fetchGoogleBooks(lookupId);
  if (!meta) {
    process.stdout.write('Google Books: no result — trying Open Library... ');
    meta = await fetchOpenLibrary(lookupId);
    console.log(meta ? 'found.\n' : 'no result.\n');
  } else {
    console.log('Found on Google Books.\n');
  }

  meta = meta || { title: '', authors: [], publisher: '', year: null, description: '',
                   page_count: null, language: '', isbn_13: '', isbn_10: '', cover_url: null };
  meta.narrators = []; meta.series = ''; meta.series_number = null;
  meta.year_edition = null; meta.duration_minutes = null; meta.asin = ''; meta.format = ''; meta.owned = false;

  console.log('─'.repeat(50));
  console.log(`  Title:       ${meta.title}`);
  console.log(`  Author:      ${meta.authors.join(', ')}`);
  console.log(`  Publisher:   ${meta.publisher}`);
  console.log(`  Year:        ${meta.year ?? ''}`);
  console.log(`  Pages:       ${meta.page_count ?? ''}`);
  console.log(`  Language:    ${meta.language}`);
  console.log(`  ISBN-13:     ${meta.isbn_13}`);
  console.log(`  ISBN-10:     ${meta.isbn_10}`);
  console.log(`  Cover:       ${meta.cover_url ? '✓ available' : '—'}`);
  console.log(`  Description: ${meta.description ? meta.description.slice(0, 80) + '…' : '—'}`);
  console.log('─'.repeat(50));
  console.log('\nPress Enter to accept, or type to override:\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // — Metadata —
  const title            = await ask(rl, 'Title',             meta.title);
  const authorRaw        = await ask(rl, 'Author(s) (comma-separated)', meta.authors.join(', '));
  const authors          = authorRaw.split(',').map(s => s.trim()).filter(Boolean);
  const publisher        = await ask(rl, 'Publisher',         meta.publisher);
  const yearStr          = await ask(rl, 'Year published',    meta.year ? String(meta.year) : '');
  const yearEditionStr   = await ask(rl, 'Year of edition',   meta.year_edition ? String(meta.year_edition) : '');
  const pagesStr         = await ask(rl, 'Pages',             meta.page_count ? String(meta.page_count) : '');
  const language         = await ask(rl, 'Language',          meta.language || 'English');
  const original_language = await ask(rl, 'Original language', '');
  const translator       = original_language ? await ask(rl, 'Translator', '') : '';
  const isbn_13          = await ask(rl, 'ISBN-13',           meta.isbn_13 || (parsed?.type === 'isbn13' ? parsed.value : ''));
  const isbn_10          = await ask(rl, 'ISBN-10',           meta.isbn_10 || (parsed?.type === 'isbn10' ? parsed.value : ''));
  const description      = await askMultiline(rl, 'Description', meta.description);

  // — Classification —
  console.log();
  const fictionIn        = await ask(rl, 'Fiction? (y/n/blank)', '');
  const isFiction        = fictionIn.toLowerCase() === 'y';
  const sourceTypeIn     = isFiction ? '' : await ask(rl, 'Source type ([p]rimary/[s]econdary/blank)', '');
  const series           = await ask(rl, 'Series',            meta.series || '');
  const series_numberStr = series ? await ask(rl, 'Series number', meta.series_number ? String(meta.series_number) : '') : '';
  const tagsIn           = await ask(rl, 'Tags (comma-separated)', '');
  console.log();

  // — Library —
  const statusIn         = await ask(rl, 'Status ([u]nread/[r]eading/[f]inished/[p]aused)', 'unread');
  // ASIN input is almost always an Audible audiobook; ISBN ingest defaults to physical.
  const formatDefault    = meta.format === 'audiobook' ? 'a'
                         : meta.format === 'ebook'     ? 'd'
                         : parsed?.type === 'asin'     ? 'a'
                         :                                'p';
  const formatIn         = await ask(rl, 'Format ([p]hysical/[d]igital/[a]udiobook)', formatDefault);
  const ownedIn          = await ask(rl, 'Owned? (y/n)', meta.owned ? 'y' : 'n');
  const prevOwnedIn      = ownedIn.toLowerCase() !== 'y' ? await ask(rl, 'Previously owned? (y/n)', 'n') : 'n';

  // — Format-specific —
  const statusVal = expand(STATUS_EXPAND, statusIn);
  const formatExpanded = expand(FORMAT_EXPAND, formatIn);
  const formatVal = formatExpanded === 'digital' ? 'ebook' : formatExpanded;
  let binding = '', condition = '', narrators = [], durationStr = '', asinIn = '';
  if (formatVal === 'physical') {
    console.log();
    binding   = await ask(rl, 'Binding ([h]ardcover/[p]aperback)', '');
    const isPhysicallyOwned = ownedIn.toLowerCase() === 'y' || prevOwnedIn.toLowerCase() === 'y';
    condition = isPhysicallyOwned ? await ask(rl, 'Condition ([n]ew/[f]ine/[v]ery good/[g]ood/f[a]ir/[p]oor)', '') : '';
  } else if (formatVal === 'audiobook') {
    console.log();
    const narratorRaw = await ask(rl, 'Narrator(s) (comma-separated)', meta.narrators.join(', '));
    narrators = narratorRaw.split(',').map(s => s.trim()).filter(Boolean);
    durationStr = await ask(rl, 'Duration (h:mm or minutes)', meta.duration_minutes ? String(meta.duration_minutes) : '');
    asinIn      = meta.asin || (parsed?.type === 'asin' ? parsed.value : await ask(rl, 'ASIN', ''));
  }

  // — Acquisition —
  let acquisition_source = '', acquisition_date = '';
  if (ownedIn.toLowerCase() === 'y' || prevOwnedIn.toLowerCase() === 'y') {
    console.log();
    // Format-aware defaults per memory: audiobook → Audible, ebook → Internet
    // (free downloads are the user's standard ebook source). Physical ingest
    // doesn't have an obvious default, so leave blank for explicit input.
    const sourceDefault = formatVal === 'audiobook' ? 'Audible'
                        : formatVal === 'ebook'     ? 'Internet'
                        :                              '';
    acquisition_source = await ask(rl, 'Acquisition source', sourceDefault);
    acquisition_date   = await ask(rl, 'Acquisition date (YYYY, YYYY-MM, or YYYY-MM-DD)', '');
  }

  // — Notes —
  console.log();
  const notes = await ask(rl, 'Notes', '');

  // — Personal —
  let ratingStr = '', lovedIn = '';
  if (expand(STATUS_EXPAND, statusIn) === 'finished') {
    console.log();
    ratingStr = await ask(rl, 'Rating (0.5–5 or blank)', '');
    lovedIn   = await ask(rl, 'Loved? (y/n)', 'n');
  }

  rl.close();

  let cover_path = null;
  if (meta.cover_url) {
    process.stdout.write('\nDownloading cover... ');
    try {
      cover_path = await downloadCover(meta.cover_url);
      console.log(cover_path ? '✓' : 'too small, skipped');
    } catch {
      console.log('failed (continuing without cover)');
    }
  }

  const fictionVal = fictionIn.toLowerCase() === 'y' ? true
                   : fictionIn.toLowerCase() === 'n' ? false
                   : undefined;

  function parseDuration(s) {
    if (!s) return undefined;
    const hm = s.match(/^(\d+):(\d{1,2})$/);
    if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
    const mins = parseInt(s);
    return isNaN(mins) ? undefined : mins;
  }
  const tags = tagsIn ? tagsIn.split(',').map(t => t.trim()).filter(Boolean) : undefined;

  const payload = Object.fromEntries(Object.entries({
    title,
    authors:           authors.length ? authors : undefined,
    publisher:         publisher || undefined,
    year_published:    yearStr ? parseInt(yearStr) : undefined,
    year_edition:      yearEditionStr ? parseInt(yearEditionStr) : undefined,
    page_count:        pagesStr ? parseInt(pagesStr) : undefined,
    language:          language || undefined,
    original_language: original_language || undefined,
    translator:        translator || undefined,
    isbn_13:           isbn_13 || undefined,
    isbn_10:           isbn_10 || undefined,
    asin:              asinIn || undefined,
    description:       description || undefined,
    fiction:           fictionVal,
    source_type:       sourceTypeIn.toLowerCase() === 'p' ? 'primary' : sourceTypeIn.toLowerCase() === 's' ? 'secondary' : (sourceTypeIn || undefined),
    series:            series || undefined,
    series_number:     series_numberStr ? parseFloat(series_numberStr) : undefined,
    tags,
    status:            ['reading', 'paused', 'finished', 'unread'].includes(statusVal) ? statusVal : 'unread',
    format:            ['physical', 'ebook', 'audiobook'].includes(formatVal) ? formatVal : undefined,
    owned:             ownedIn.toLowerCase() === 'y' ? 1 : 0,
    previously_owned:  prevOwnedIn.toLowerCase() === 'y' ? 1 : 0,
    binding:           ['hardcover', 'paperback'].includes(expand(BINDING_EXPAND, binding)) ? expand(BINDING_EXPAND, binding) : undefined,
    condition:         ['new', 'fine', 'very good', 'good', 'fair', 'poor'].includes(expand(CONDITION_EXPAND, condition)) ? expand(CONDITION_EXPAND, condition) : undefined,
    narrators:         narrators.length ? narrators : undefined,
    duration_minutes:  parseDuration(durationStr),
    acquisition_source: acquisition_source || undefined,
    acquisition_date:  acquisition_date || undefined,
    notes:             notes || undefined,
    rating:            ratingStr ? parseFloat(ratingStr) : undefined,
    loved:             lovedIn.toLowerCase() === 'y' ? 1 : undefined,
    cover_path:        cover_path || undefined,
  }).filter(([, v]) => v !== undefined));

  process.stdout.write('\nAdding to Spine... ');
  const { status, body } = await postBook(payload);

  if (status === 200 || status === 201) {
    console.log('✓');
    console.log(`\n  "${body.title}" added — ${API_BASE.replace('localhost', '127.0.0.1')}/books/${body.id}\n`);
    process.exit(0);
  } else {
    console.log('failed');
    console.error(`\n  API error (${status}): ${JSON.stringify(body)}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
