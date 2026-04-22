#!/usr/bin/env node
// Usage: node ingest.js <amazon-url-or-isbn>

import readline from 'readline';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, 'uploads');
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
    author:       v.authors?.[0] || '',
    publisher:    v.publisher || '',
    year:         v.publishedDate ? parseInt(v.publishedDate) : null,
    description:  v.description || '',
    page_count:   v.pageCount || null,
    language:     LANG_MAP[v.language] || v.language || '',
    isbn_13:      ids.find(i => i.type === 'ISBN_13')?.identifier || '',
    isbn_10:      ids.find(i => i.type === 'ISBN_10')?.identifier || '',
    cover_url:    coverUrl ? coverUrl.replace('&edge=curl', '').replace(/zoom=\d/, 'zoom=0') : null,
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
    author:      item.authors?.[0]?.name || '',
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
  const { status, body, headers } = await get(url);
  if (status !== 200 || body.length < 1000) return null;
  const ct = headers['content-type'] || '';
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), body);
  return `/uploads/${filename}`;
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
        lines.push(line);
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

  const parsed = parseInput(input);
  const lookupId = parsed.value;
  console.log(`\nLooking up ${parsed.type.toUpperCase()} ${lookupId}...\n`);

  let meta = await fetchGoogleBooks(lookupId);
  if (!meta) {
    process.stdout.write('Google Books: no result — trying Open Library... ');
    meta = await fetchOpenLibrary(lookupId);
    console.log(meta ? 'found.\n' : 'no result.\n');
  } else {
    console.log('Found on Google Books.\n');
  }

  meta = meta || { title: '', author: '', publisher: '', year: null, description: '',
                   page_count: null, language: '', isbn_13: '', isbn_10: '', cover_url: null };

  console.log('─'.repeat(50));
  console.log(`  Title:       ${meta.title}`);
  console.log(`  Author:      ${meta.author}`);
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
  const author           = await ask(rl, 'Author',            meta.author);
  const publisher        = await ask(rl, 'Publisher',         meta.publisher);
  const yearStr          = await ask(rl, 'Year published',    meta.year ? String(meta.year) : '');
  const yearEditionStr   = await ask(rl, 'Year of edition',   '');
  const pagesStr         = await ask(rl, 'Pages',             meta.page_count ? String(meta.page_count) : '');
  const language         = await ask(rl, 'Language',          meta.language || 'English');
  const original_language = await ask(rl, 'Original language', '');
  const isbn_13          = await ask(rl, 'ISBN-13',           meta.isbn_13);
  const isbn_10          = await ask(rl, 'ISBN-10',           meta.isbn_10);
  const description      = await askMultiline(rl, 'Description', meta.description);

  // — Classification —
  console.log();
  const fictionIn        = await ask(rl, 'Fiction? (y/n/blank)', '');
  const series           = await ask(rl, 'Series',            '');
  const series_numberStr = series ? await ask(rl, 'Series number', '') : '';
  const tagsIn           = await ask(rl, 'Tags (comma-separated)', '');

  // — Library —
  console.log();
  const statusIn         = await ask(rl, 'Status (unread/reading/finished)', 'unread');
  const formatIn         = await ask(rl, 'Format (physical/digital/audiobook)', 'physical');
  const ownedIn          = await ask(rl, 'Owned? (y/n)', 'n');

  // — Format-specific —
  const formatVal = formatIn === 'digital' ? 'ebook' : formatIn;
  let binding = '', condition = '', narrator = '', asinIn = '';
  if (formatVal === 'physical') {
    console.log();
    binding   = await ask(rl, 'Binding (hardcover/paperback)', '');
    condition = await ask(rl, 'Condition (new/fine/very good/good/fair/poor)', '');
  } else if (formatVal === 'audiobook') {
    console.log();
    narrator  = await ask(rl, 'Narrator', '');
    asinIn    = await ask(rl, 'ASIN', parsed.type === 'asin' ? parsed.value : '');
  }

  // — Notes —
  console.log();
  const notes = await askMultiline(rl, 'Notes', '');

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
  const tags = tagsIn ? tagsIn.split(',').map(t => t.trim()).filter(Boolean) : undefined;

  const payload = Object.fromEntries(Object.entries({
    title,
    author:            author || undefined,
    publisher:         publisher || undefined,
    year_published:    yearStr ? parseInt(yearStr) : undefined,
    year_edition:      yearEditionStr ? parseInt(yearEditionStr) : undefined,
    page_count:        pagesStr ? parseInt(pagesStr) : undefined,
    language:          language || undefined,
    original_language: original_language || undefined,
    isbn_13:           isbn_13 || undefined,
    isbn_10:           isbn_10 || undefined,
    asin:              asinIn || undefined,
    description:       description || undefined,
    fiction:           fictionVal,
    series:            series || undefined,
    series_number:     series_numberStr ? parseFloat(series_numberStr) : undefined,
    tags,
    status:            ['reading', 'paused', 'finished', 'unread'].includes(statusIn) ? statusIn : 'unread',
    format:            ['physical', 'ebook', 'audiobook'].includes(formatVal) ? formatVal : undefined,
    owned:             ownedIn.toLowerCase() === 'y' ? 1 : 0,
    binding:           ['hardcover', 'paperback'].includes(binding) ? binding : undefined,
    condition:         ['new', 'fine', 'very good', 'good', 'fair', 'poor'].includes(condition) ? condition : undefined,
    narrator:          narrator || undefined,
    notes:             notes || undefined,
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
