// Virtual-tag rules: each rule's `name` must also appear in
// shared/bookFields.js → VIRTUAL_TAG_NAMES so the form filters them out of
// past-tag suggestions. Two lists exist because this file pulls in server-only
// SQLite imports and can't be loaded in the browser bundle.
export const VIRTUAL_TAG_RULES = [
  {
    // Antique/Vintage signal a physically older copy, so we restrict to
    // format='physical'. A 200-year-old text with a recent audiobook edition
    // shouldn't qualify; a 1900 hardcover should.
    name: 'Antique',
    test: (book) => {
      const year = book.year_edition;
      return Boolean(book.format === 'physical' && year && new Date().getFullYear() - year >= 100);
    },
    sql: "(format = 'physical' AND year_edition IS NOT NULL AND (CAST(strftime('%Y','now','localtime') AS INTEGER) - year_edition) >= 100)",
  },
  {
    name: 'Vintage',
    test: (book) => {
      const year = book.year_edition;
      const age = year && new Date().getFullYear() - year;
      return Boolean(book.format === 'physical' && age && age >= 50 && age < 100);
    },
    sql: "(format = 'physical' AND year_edition IS NOT NULL AND (CAST(strftime('%Y','now','localtime') AS INTEGER) - year_edition) >= 50 AND (CAST(strftime('%Y','now','localtime') AS INTEGER) - year_edition) < 100)",
  },
  {
    name: 'Translated',
    test: (book) => Boolean(book.original_language && book.original_language !== book.language),
    sql: "(original_language IS NOT NULL AND original_language != '' AND (language IS NULL OR original_language != language))",
  },
  {
    name: 'Re-read',
    test: (book) => book.read_count > 1,
    sql: "(read_count > 1)",
  },
  {
    name: 'Abridged',
    test: (book) => Boolean(book.abridged),
    sql: "(abridged = 1)",
  },
  {
    name: 'Long',
    test: (book) => book.page_count >= 500,
    sql: "(page_count >= 500)",
  },
  {
    name: 'Short',
    test: (book) => book.page_count > 0 && book.page_count <= 150,
    sql: "(page_count > 0 AND page_count <= 150)",
  },
];

const BROWSE_FIELDS = new Set(['publisher', 'series', 'language', 'format']);

export function appendWhere(where, extra) {
  return where ? `${where} AND (${extra})` : `WHERE (${extra})`;
}

export function buildFilterConditions(query) {
  const conditions = [];
  const params = [];

  const tab = query.tab || query.status;
  if      (tab === 'reading')    conditions.push("status = 'reading'");
  else if (tab === 'paused')     conditions.push("status = 'paused'");
  else if (tab === 'finished')   conditions.push("status = 'finished'");
  else if (tab === 'unread')     conditions.push("status = 'unread'");
  else if (tab === 'owned')      conditions.push("owned = 1");
  else if (tab === 'prev_owned') conditions.push("previously_owned = 1");
  else if (tab === 'loved')      conditions.push("loved = 1");

  if (query.field && query.value != null) {
    const f = query.field;
    const v = query.value;
    if (f === 'tag') {
      conditions.push("id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE t.name = ?)");
      params.push(v);
    } else if (f === 'narrator') {
      conditions.push("id IN (SELECT bn.book_id FROM book_narrators bn JOIN narrators n ON bn.narrator_id = n.id WHERE n.name = ?)");
      params.push(v);
    } else if (f === 'author') {
      conditions.push("id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE a.name = ?)");
      params.push(v);
    } else if (f === 'translator') {
      conditions.push("id IN (SELECT bt.book_id FROM book_translators bt JOIN translators t ON bt.translator_id = t.id WHERE t.name = ?)");
      params.push(v);
    } else if (f === 'fiction') {
      if (v === 'fiction')         conditions.push("fiction = 1");
      else if (v === 'nonfiction') conditions.push("fiction = 0");
      else                         conditions.push("fiction IS NULL");
    } else if (f === 'rating') {
      conditions.push("rating = ?");
      params.push(parseFloat(v));
    } else if (f === 'year_finished') {
      conditions.push("date_finished LIKE ?");
      params.push(v + '%');
    } else if (BROWSE_FIELDS.has(f)) {
      conditions.push(`${f} = ?`);
      params.push(v);
    }
  }

  if (query.q) {
    const like = `%${query.q.toLowerCase()}%`;
    conditions.push("(LOWER(title) LIKE ? OR LOWER(COALESCE(series,'')) LIKE ? OR id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE LOWER(t.name) LIKE ?) OR id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE LOWER(a.name) LIKE ?) OR id IN (SELECT bn.book_id FROM book_narrators bn JOIN narrators n ON bn.narrator_id = n.id WHERE LOWER(n.name) LIKE ?) OR id IN (SELECT btr.book_id FROM book_translators btr JOIN translators tr ON btr.translator_id = tr.id WHERE LOWER(tr.name) LIKE ?))");
    params.push(like, like, like, like, like, like);
  }

  const fmts = [].concat(query.formats || []).filter(Boolean);
  if (fmts.length) {
    const hasEmpty = fmts.includes('empty');
    const real = fmts.filter(f => f !== 'empty');
    if (hasEmpty && real.length) { conditions.push(`(format IS NULL OR format IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("format IS NULL");
    else { conditions.push(`format IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const rts = [].concat(query.ratings || []).filter(Boolean);
  if (rts.length) {
    const hasEmpty = rts.includes('empty');
    const real = rts.filter(r => r !== 'empty').map(Number).filter(n => !isNaN(n));
    if (hasEmpty && real.length) { conditions.push(`(rating IS NULL OR rating IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("rating IS NULL");
    else { conditions.push(`rating IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const pubs = [].concat(query.publishers || []).filter(Boolean);
  if (pubs.length) {
    const hasEmpty = pubs.includes('empty');
    const real = pubs.filter(p => p !== 'empty');
    if (hasEmpty && real.length) { conditions.push(`(publisher IS NULL OR publisher IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("(publisher IS NULL OR publisher = '')");
    else { conditions.push(`publisher IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const srcs = [].concat(query.sources || []).filter(Boolean);
  if (srcs.length) {
    const hasEmpty = srcs.includes('empty');
    const real = srcs.filter(s => s !== 'empty');
    if (hasEmpty && real.length) { conditions.push(`(acquisition_source IS NULL OR acquisition_source IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("(acquisition_source IS NULL OR acquisition_source = '')");
    else { conditions.push(`acquisition_source IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const sers = [].concat(query.series || []).filter(Boolean);
  if (sers.length) {
    const hasEmpty = sers.includes('empty');
    const real = sers.filter(s => s !== 'empty');
    if (hasEmpty && real.length) { conditions.push(`(series IS NULL OR series IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("(series IS NULL OR series = '')");
    else { conditions.push(`series IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const selectedTags = [].concat(query.tags || []).filter(Boolean);
  if (selectedTags.length) {
    const virtualNames = new Set(VIRTUAL_TAG_RULES.map(r => r.name));
    const realTags = selectedTags.filter(t => !virtualNames.has(t));
    const virtualTags = selectedTags.filter(t => virtualNames.has(t));
    if (realTags.length) {
      conditions.push(`id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE t.name IN (${realTags.map(() => '?').join(',')}))`);
      params.push(...realTags);
    }
    for (const name of virtualTags) {
      const rule = VIRTUAL_TAG_RULES.find(r => r.name === name);
      if (rule) conditions.push(rule.sql);
    }
  }

  const missing = [].concat(query.missing || []).filter(Boolean);
  for (const m of missing) {
    if (m === 'cover')           conditions.push("(cover_path IS NULL OR cover_path = '')");
    else if (m === 'author')     conditions.push("id NOT IN (SELECT book_id FROM book_authors)");
    else if (m === 'narrator')   conditions.push("format = 'audiobook' AND id NOT IN (SELECT book_id FROM book_narrators)");
    else if (m === 'format')     conditions.push("format IS NULL");
    else if (m === 'isbn')       conditions.push("COALESCE(is_custom,0)=0 AND (format IS NULL OR format NOT IN ('ebook')) AND isbn_10 IS NULL AND isbn_13 IS NULL AND asin IS NULL AND NOT (COALESCE(year_published,0)<1970 AND COALESCE(year_edition,0)<1970)");
    else if (m === 'publisher')  conditions.push("(publisher IS NULL OR publisher = '')");
    else if (m === 'year')       conditions.push("year_published IS NULL");
    else if (m === 'pages')      conditions.push("CASE WHEN format='audiobook' THEN duration_minutes IS NULL ELSE page_count IS NULL END");
    else if (m === 'language')   conditions.push("(language IS NULL OR language = '')");
    else if (m === 'rating')     conditions.push("rating IS NULL AND status='finished'");
    else if (m === 'fiction')    conditions.push("fiction IS NULL");
    else if (m === 'description') conditions.push("(description IS NULL OR description = '')");
  }

  if (query.owned === 'true')            conditions.push("owned = 1");
  else if (query.owned === 'false')      conditions.push("COALESCE(owned,0) = 0");
  if (query.previouslyOwned === 'true')  conditions.push("previously_owned = 1");
  if (query.custom === 'true')           conditions.push("is_custom = 1");
  else if (query.custom === 'false')     conditions.push("COALESCE(is_custom,0) = 0");
  if (query.loved === 'true')            conditions.push("loved = 1");
  else if (query.loved === 'false')      conditions.push("COALESCE(loved,0) = 0");

  return { conditions, params };
}

export function buildOrderBy(sort, field) {
  const titleSort = "LOWER(CASE WHEN LOWER(title) LIKE 'the %' THEN SUBSTR(title,5) WHEN LOWER(title) LIKE 'an %' THEN SUBSTR(title,4) WHEN LOWER(title) LIKE 'a %' THEN SUBSTR(title,3) ELSE title END)";
  if (field === 'series')        return `COALESCE(series_number,9999) ASC, ${titleSort} ASC`;
  if (field === 'year_finished') return "date_finished ASC";
  if (field)                     return `${titleSort} ASC, COALESCE(series_number,9999) ASC`;
  switch (sort) {
    case 'added':    return "id DESC";
    case 'title':    return `${titleSort} ASC, COALESCE(series_number,9999) ASC`;
    case 'author':   return "COALESCE((SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = books.id ORDER BY ba.position LIMIT 1), '') ASC";
    case 'rating':   return "COALESCE(rating,0) DESC";
    case 'progress': return "CASE WHEN format='audiobook' THEN CAST(COALESCE(current_minutes,0) AS REAL)/NULLIF(duration_minutes,0) ELSE CAST(COALESCE(current_page,0) AS REAL)/NULLIF(page_count,0) END DESC";
    case 'started':  return "COALESCE(date_started,'') DESC";
    case 'finished': return "COALESCE(date_finished,'') DESC";
    case 'length':   return "COALESCE(page_count,duration_minutes,0) DESC";
    default:         return "updated_at DESC";
  }
}
