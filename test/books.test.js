import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('books', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  async function req(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, body: data };
  }

  describe('GET /api/books', () => {
    it('returns empty list initially', async () => {
      const { status, body } = await req('GET', '/api/books');
      assert.equal(status, 200);
      assert.deepEqual(body.books, []);
      assert.equal(body.total, 0);
    });
  });

  describe('GET /api/books/facets', () => {
    it('surfaces author names in the authors facet', async () => {
      await req('POST', '/api/books', {
        title: 'Dune', authors: ['Frank Herbert'],
      });
      const { status, body } = await req('GET', '/api/books/facets');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.authors));
      assert.ok(body.authors.includes('Frank Herbert'),
        `expected authors facet to include "Frank Herbert", got ${JSON.stringify(body.authors)}`);
    });

    it('surfaces narrator names in the narrators facet', async () => {
      await req('POST', '/api/books', {
        title: 'Audio Book', narrators: ['Stephen Fry'],
      });
      const { status, body } = await req('GET', '/api/books/facets');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.narrators));
      assert.ok(body.narrators.includes('Stephen Fry'),
        `expected narrators facet to include "Stephen Fry", got ${JSON.stringify(body.narrators)}`);
    });

    it('surfaces translator names in the translators facet', async () => {
      await req('POST', '/api/books', {
        title: 'Crime and Punishment',
        translators: ['Constance Garnett'],
      });
      const { status, body } = await req('GET', '/api/books/facets');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.translators));
      assert.ok(body.translators.includes('Constance Garnett'),
        `expected translators facet to include "Constance Garnett", got ${JSON.stringify(body.translators)}`);
    });
  });

  describe('POST /api/books', () => {
    it('creates a book and returns it', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Dune' });
      assert.equal(status, 201);
      assert.equal(body.title, 'Dune');
      assert.ok(body.id);
      assert.deepEqual(body.tags, []);
    });

    it('creates a book with tags', async () => {
      const { status, body } = await req('POST', '/api/books', {
        title: 'Foundation',
        tags: ['sci-fi', 'classic'],
      });
      assert.equal(status, 201);
      assert.equal(body.tags.length, 2);
      assert.ok(body.tags.some(t => t.name === 'sci-fi'));
      assert.ok(body.tags.some(t => t.name === 'classic'));
    });

    it('rejects missing title', async () => {
      const { status, body } = await req('POST', '/api/books', { author: 'Someone' });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('rejects invalid status', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', status: 'nope' });
      assert.equal(status, 400);
    });

    it('rejects invalid ISBN-10', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_10: '123' });
      assert.equal(status, 400);
    });

    it('accepts ISBN-10 with trailing X', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_10: '197470937X' });
      assert.equal(status, 201);
    });

    it('rejects invalid ISBN-13', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_13: '123' });
      assert.equal(status, 400);
    });

    it('rejects impossible date', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', date_started: '2026-99-99' });
      assert.equal(status, 400);
    });

    it('rejects calendar-rollover dates (Feb 31, Apr 31, Feb 29 non-leap)', async () => {
      // Plain new Date('2024-02-31') silently rolls to March 2; we must catch
      // those with component-equality, not just a NaN check.
      for (const bad of ['2024-02-31', '2024-04-31', '2023-02-29', '2024-06-00']) {
        const { status } = await req('POST', '/api/books', { title: 'X', date_started: bad });
        assert.equal(status, 400, `expected 400 for ${bad}`);
      }
    });

    it('accepts Feb 29 in a leap year', async () => {
      const { status } = await req('POST', '/api/books', { title: 'Leap', date_started: '2024-02-29' });
      assert.equal(status, 201);
    });

    it('rejects calendar-rollover acquisition dates', async () => {
      for (const bad of ['2024-02-31', '2024-13-01', '2023-02-29']) {
        const { status } = await req('POST', '/api/books', { title: 'X', acquisition_date: bad });
        assert.equal(status, 400, `expected 400 for ${bad}`);
      }
    });

    it('accepts year-only and year-month acquisition dates', async () => {
      const a = await req('POST', '/api/books', { title: 'Year only', acquisition_date: '1995' });
      assert.equal(a.status, 201);
      const b = await req('POST', '/api/books', { title: 'Year-month', acquisition_date: '1995-06' });
      assert.equal(b.status, 201);
    });

    it('rejects negative, fractional, or non-numeric read_count', async () => {
      // NaN and Infinity are out of scope: JSON.stringify drops them to null
      // before they reach the server, so they can never be the validation target.
      for (const bad of [-1, 1.5, 'abc']) {
        const { status } = await req('POST', '/api/books', { title: 'X', read_count: bad });
        assert.equal(status, 400, `expected 400 for read_count=${String(bad)}`);
      }
    });

    it('PUT persists a valid read_count override', async () => {
      // Creation always starts read_count at 0 (the column isn't in the POST
      // writable set); PUT is the path that honours a manual override.
      const { body: created } = await req('POST', '/api/books', { title: 'Counter' });
      assert.equal(created.read_count, 0);
      const { body: updated } = await req('PUT', `/api/books/${created.id}`, {
        ...created, read_count: 3, tags: [],
      });
      assert.equal(updated.read_count, 3);
    });

    it('rejects bad read_count on PUT (does not corrupt stored value)', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Read counter' });
      const { status } = await req('PUT', `/api/books/${created.id}`, {
        ...created, read_count: -2, tags: [],
      });
      assert.equal(status, 400);
      const { body: refetched } = await req('GET', `/api/books/${created.id}`);
      assert.equal(refetched.read_count, 0);
    });
  });

  describe('GET /api/books/:id', () => {
    it('returns the book', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Neuromancer' });
      const { status, body } = await req('GET', `/api/books/${created.id}`);
      assert.equal(status, 200);
      assert.equal(body.title, 'Neuromancer');
    });

    it('returns 404 for unknown id', async () => {
      const { status } = await req('GET', '/api/books/99999');
      assert.equal(status, 404);
    });

    it('returns 400 for non-integer id', async () => {
      const { status } = await req('GET', '/api/books/abc');
      assert.equal(status, 400);
    });
  });

  describe('PUT /api/books/:id', () => {
    it('updates book fields', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Old Title' });
      const { status, body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'New Title',
        status: 'reading',
      });
      assert.equal(status, 200);
      assert.equal(body.title, 'New Title');
      assert.equal(body.status, 'reading');
    });

    it('syncs tags on update', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Tagged Book',
        tags: ['fantasy'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Tagged Book',
        tags: ['sci-fi', 'dystopia'],
      });
      assert.equal(body.tags.length, 2);
      assert.ok(body.tags.every(t => ['sci-fi', 'dystopia'].includes(t.name)));
    });

    it('returns 404 for unknown id', async () => {
      const { status } = await req('PUT', '/api/books/99999', { title: 'X' });
      assert.equal(status, 404);
    });

    it('rejects invalid source_type', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', source_type: 'tertiary' });
      assert.equal(status, 400);
    });

    it('saves and returns fiction flag', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Dune', fiction: true });
      assert.equal(created.fiction, 1);
      const { body } = await req('PUT', `/api/books/${created.id}`, { title: 'Dune', fiction: false });
      assert.equal(body.fiction, 0);
      const { body: cleared } = await req('PUT', `/api/books/${created.id}`, { title: 'Dune' });
      assert.equal(cleared.fiction, null);
    });

    it('saves source_type for non-fiction', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Thucydides', fiction: false, source_type: 'primary' });
      assert.equal(body.fiction, 0);
      assert.equal(body.source_type, 'primary');
    });

    it('saves and returns previously_owned flag', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Sold Book', previously_owned: true });
      assert.equal(status, 201);
      assert.equal(body.previously_owned, 1);
      assert.equal(body.owned, 0);
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, { title: 'Sold Book', previously_owned: false });
      assert.equal(updated.previously_owned, 0);
    });

    it('owned and previously_owned are mutually exclusive', async () => {
      const { body: a } = await req('POST', '/api/books', { title: 'Conflict A', owned: true, previously_owned: true });
      assert.equal(a.owned, 1);       // owned wins
      assert.equal(a.previously_owned, 0);
      const { body: b } = await req('POST', '/api/books', { title: 'Conflict B', owned: true });
      const { body: updated } = await req('PUT', `/api/books/${b.id}`, { title: 'Conflict B', owned: false, previously_owned: true });
      assert.equal(updated.owned, 0);
      assert.equal(updated.previously_owned, 1);
    });

    it('saves and returns ASIN', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Audible Book', asin: 'B01N4P45MO' });
      assert.equal(status, 201);
      assert.equal(body.asin, 'B01N4P45MO');
    });

    it('rejects invalid ASIN', async () => {
      const { status } = await req('POST', '/api/books', { title: 'Bad ASIN', asin: '123' });
      assert.equal(status, 400);
    });

    it('accepts half-star rating', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Half Star', rating: 3.5 });
      assert.equal(status, 201);
      assert.equal(body.rating, 3.5);
    });

    it('rejects non-half-increment rating', async () => {
      const { status } = await req('POST', '/api/books', { title: 'Bad Rating', rating: 3.3 });
      assert.equal(status, 400);
    });

    it('saves and returns year_approximate flag', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Old Book', year_published: 1900, year_approximate: true });
      assert.equal(status, 201);
      assert.equal(body.year_published, 1900);
      assert.equal(body.year_approximate, 1);
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, { title: 'Old Book', year_published: 1900, year_approximate: false });
      assert.equal(updated.year_approximate, 0);
    });

    it('saves and returns abridged flag', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Short Cut', abridged: true });
      assert.equal(status, 201);
      assert.equal(body.abridged, 1);
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, { title: 'Short Cut', abridged: false });
      assert.equal(updated.abridged, 0);
    });

    it('defaults abridged to 0 when omitted', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Full Length' });
      assert.equal(body.abridged, 0);
    });

    it('surfaces Abridged as a virtual tag and filters by it', async () => {
      const { body: abridgedBook } = await req('POST', '/api/books', { title: 'Cliffs Edition', abridged: true });
      const { body: fullBook }     = await req('POST', '/api/books', { title: 'Full Edition',   abridged: false });
      // Virtual tag appears on the abridged book and not on the full one.
      assert.ok(abridgedBook.tags.some(t => t.name === 'Abridged' && t.virtual === true),
        'expected Abridged virtual tag on abridged book');
      assert.ok(!fullBook.tags.some(t => t.name === 'Abridged'),
        'expected no Abridged tag on full-length book');
      // Filter by virtual tag: returns the abridged book, excludes the full one.
      const { body: filtered } = await req('GET', '/api/books?tags[]=Abridged');
      const ids = filtered.books.map(b => b.id);
      assert.ok(ids.includes(abridgedBook.id), 'expected abridged book in filtered result');
      assert.ok(!ids.includes(fullBook.id),    'expected full book excluded from filtered result');
    });
  });

  describe('PATCH /api/books/:id', () => {
    it('updates current_page', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Progress Book' });
      const { status, body } = await req('PATCH', `/api/books/${created.id}`, { current_page: 42 });
      assert.equal(status, 200);
      assert.equal(body.current_page, 42);
    });

    it('updates current_minutes', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Audio Book' });
      const { status, body } = await req('PATCH', `/api/books/${created.id}`, { current_minutes: 120 });
      assert.equal(status, 200);
      assert.equal(body.current_minutes, 120);
    });

    it('rejects negative page number', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Bad Page' });
      const { status } = await req('PATCH', `/api/books/${created.id}`, { current_page: -1 });
      assert.equal(status, 400);
    });

    it('rejects blank progress values', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Blank Progress' });
      const page = await req('PATCH', `/api/books/${created.id}`, { current_page: '' });
      assert.equal(page.status, 400);
      const minutes = await req('PATCH', `/api/books/${created.id}`, { current_minutes: '' });
      assert.equal(minutes.status, 400);
    });

    it('coerces numeric strings for progress values', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'String Progress' });
      const { status, body } = await req('PATCH', `/api/books/${created.id}`, { current_page: '12', current_minutes: '30' });
      assert.equal(status, 200);
      assert.equal(body.current_page, 12);
      assert.equal(body.current_minutes, 30);
    });
  });

  describe('DELETE /api/books/:id', () => {
    it('deletes the book', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'To Delete' });
      const { status } = await req('DELETE', `/api/books/${created.id}`);
      assert.equal(status, 204);
      const { status: getStatus } = await req('GET', `/api/books/${created.id}`);
      assert.equal(getStatus, 404);
    });

    it('returns 404 for unknown id', async () => {
      const { status } = await req('DELETE', '/api/books/99999');
      assert.equal(status, 404);
    });
  });

  describe('reads', () => {
    let bookId;

    before(async () => {
      const { body } = await req('POST', '/api/books', { title: 'Read History Book' });
      bookId = body.id;
    });

    it('returns empty reads list initially', async () => {
      const { status, body } = await req('GET', `/api/books/${bookId}/reads`);
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('creates a read entry', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-01-01',
        date_finished: '2024-01-15',
      });
      assert.equal(status, 201);
      assert.equal(body.date_started, '2024-01-01');
      assert.equal(body.date_finished, '2024-01-15');
      assert.equal(body.book_id, bookId);
    });

    it('creates a read entry with only date_started', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-02-01',
      });
      assert.equal(status, 201);
      assert.equal(body.date_started, '2024-02-01');
      assert.equal(body.date_finished, null);
    });

    it('rejects date_finished before date_started on POST', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-03-15',
        date_finished: '2024-03-01',
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('rejects invalid date on POST', async () => {
      const { status } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-99-99',
      });
      assert.equal(status, 400);
    });

    it('updates a read entry', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-04-01',
      });
      const { status, body } = await req('PUT', `/api/books/${bookId}/reads/${created.id}`, {
        date_started: '2024-04-01',
        date_finished: '2024-04-30',
      });
      assert.equal(status, 200);
      assert.equal(body.date_finished, '2024-04-30');
    });

    it('rejects date_finished before date_started on PUT', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-05-01',
      });
      const { status, body } = await req('PUT', `/api/books/${bookId}/reads/${created.id}`, {
        date_started: '2024-05-15',
        date_finished: '2024-05-01',
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('deletes a read entry', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_finished: '2024-06-01',
      });
      const { status } = await req('DELETE', `/api/books/${bookId}/reads/${created.id}`);
      assert.equal(status, 204);
    });

    it('returns 404 for unknown read id', async () => {
      const { status } = await req('DELETE', `/api/books/${bookId}/reads/99999`);
      assert.equal(status, 404);
    });

    it('returns 400 for non-integer book id on reads', async () => {
      const { status } = await req('GET', '/api/books/abc/reads');
      assert.equal(status, 400);
    });
  });

  describe('field persistence', () => {
    it('saves and returns authors', async () => {
      const { status, body } = await req('POST', '/api/books', {
        title: 'Dune', authors: ['Frank Herbert'],
      });
      assert.equal(status, 201);
      assert.equal(body.authors.length, 1);
      assert.equal(body.authors[0].name, 'Frank Herbert');
    });

    it('saves and returns narrators', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dune Audio', narrators: ['Scott Brick'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'Scott Brick');
    });

    it('saves description, notes, review, series, series_number', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Fellowship',
        description: 'A hobbit leaves home.',
        notes: 'First edition.',
        review: 'Loved it.',
        series: 'The Lord of the Rings',
        series_number: 1,
      });
      assert.equal(body.description, 'A hobbit leaves home.');
      assert.equal(body.notes, 'First edition.');
      assert.equal(body.review, 'Loved it.');
      assert.equal(body.series, 'The Lord of the Rings');
      assert.equal(body.series_number, 1);
    });

    it('saves translators and original_language', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Crime and Punishment',
        translators: ['Richard Pevear', 'Larissa Volokhonsky'],
        original_language: 'Russian',
        language: 'English',
      });
      assert.deepEqual(body.translators.map(t => t.name), ['Richard Pevear', 'Larissa Volokhonsky']);
      assert.equal(body.original_language, 'Russian');
    });

    it('q search matches translator names', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Anna Karenina', translators: ['Constance Garnett'],
      });
      const { body: results } = await req('GET', '/api/books?q=Garnett');
      assert.ok(results.books.some(b => b.id === book.id),
        'expected q=Garnett to match book translated by Constance Garnett');
    });

    it('field=author/narrator/translator filter by people name', async () => {
      const cases = [
        { field: 'author',     key: 'authors',     match: 'Browse Author',     other: 'Other Author' },
        { field: 'narrator',   key: 'narrators',   match: 'Browse Narrator',   other: 'Other Narrator' },
        { field: 'translator', key: 'translators', match: 'Browse Translator', other: 'Other Translator' },
      ];

      for (const c of cases) {
        const { body: matched } = await req('POST', '/api/books', {
          title: `${c.field} Browse Match`, [c.key]: [c.match],
        });
        const { body: other } = await req('POST', '/api/books', {
          title: `${c.field} Browse Other`, [c.key]: [c.other],
        });

        const { body: results } = await req('GET', `/api/books?field=${c.field}&value=${encodeURIComponent(c.match)}`);
        const ids = results.books.map(b => b.id);

        assert.ok(ids.includes(matched.id),
          `expected field=${c.field} to include books with the selected ${c.field}`);
        assert.ok(!ids.includes(other.id),
          `expected field=${c.field} to exclude books with a different ${c.field}`);
      }
    });

    it('missing[]=translator finds translated books with no translator entered', async () => {
      const { body: needs } = await req('POST', '/api/books', {
        title: 'Translated, no translator', original_language: 'German',
      });
      const { body: complete } = await req('POST', '/api/books', {
        title: 'Translated, has translator', original_language: 'Russian',
        translators: ['Constance Garnett'],
      });
      const { body: monolingual } = await req('POST', '/api/books', {
        title: 'Original English work', // no original_language
      });
      const { body: results } = await req('GET', '/api/books?missing[]=translator');
      const ids = results.books.map(b => b.id);
      assert.ok(ids.includes(needs.id),
        'expected book with original_language but no translator to match');
      assert.ok(!ids.includes(complete.id),
        'expected book with translator already entered to be excluded');
      assert.ok(!ids.includes(monolingual.id),
        'expected non-translated book to be excluded');
    });

    it('saves acquisition_source and acquisition_date', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Sourced Book',
        acquisition_source: 'Audible',
        acquisition_date: '2025-06',
      });
      assert.equal(body.acquisition_source, 'Audible');
      assert.equal(body.acquisition_date, '2025-06');
    });

    it('saves duration_minutes and page_count', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Long Book', page_count: 800, duration_minutes: 1200,
      });
      assert.equal(body.page_count, 800);
      assert.equal(body.duration_minutes, 1200);
    });

    it('defaults language to English when omitted', async () => {
      const { body } = await req('POST', '/api/books', { title: 'No Lang' });
      assert.equal(body.language, 'English');
    });

    it('normalizes ISBN-10 by stripping hyphens', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Hyphen ISBN', isbn_10: '0-19-285397-9' });
      assert.equal(body.isbn_10, '0192853979');
    });

    it('normalizes ISBN-13 by stripping hyphens', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Hyphen ISBN13', isbn_13: '978-0-7432-7356-5' });
      assert.equal(body.isbn_13, '9780743273565');
    });

    it('normalizes ASIN to uppercase', async () => {
      const { body } = await req('POST', '/api/books', { title: 'ASIN Book', asin: 'b01n4p45mo' });
      assert.equal(body.asin, 'B01N4P45MO');
    });
  });

  describe('joined field sync', () => {
    it('replaces authors on PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Changing Authors', authors: ['Old Author'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Changing Authors', authors: ['New Author A', 'New Author B'],
      });
      assert.equal(body.authors.length, 2);
      assert.ok(body.authors.every(a => ['New Author A', 'New Author B'].includes(a.name)));
      assert.ok(body.authors.every(a => a.name !== 'Old Author'));
    });

    it('preserves author position order', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Co-authored', authors: ['Alice', 'Bob', 'Carol'],
      });
      assert.deepEqual(body.authors.map(a => a.name), ['Alice', 'Bob', 'Carol']);
    });

    it('preserves narrator position order', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Multi-narrator', narrators: ['Alpha Voice', 'Bravo Voice', 'Charlie Voice'],
      });
      assert.deepEqual(body.narrators.map(n => n.name), ['Alpha Voice', 'Bravo Voice', 'Charlie Voice']);
    });

    it('preserves translator position order', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Multi-translator', translators: ['Trans Alpha', 'Trans Bravo', 'Trans Charlie'],
      });
      assert.deepEqual(body.translators.map(t => t.name), ['Trans Alpha', 'Trans Bravo', 'Trans Charlie']);
    });

    it('deduplicates authors case-insensitively within one sync', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dupe Authors', authors: ['Frank Herbert', 'frank herbert'],
      });
      assert.equal(body.authors.length, 1);
      assert.equal(body.authors[0].name, 'Frank Herbert');
    });

    it('deduplicates translators case-insensitively within one sync', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dupe Translators', translators: ['Constance Garnett', 'constance garnett'],
      });
      assert.equal(body.translators.length, 1);
      assert.equal(body.translators[0].name, 'Constance Garnett');
    });

    it('deduplicates narrators case-insensitively within one sync', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dupe Narrators', narrators: ['Toby Longworth', 'toby longworth'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'Toby Longworth');
    });

    it('reuses existing author row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Book One', authors: ['Shared Author'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Book Two', authors: ['Shared Author'],
      });
      assert.equal(b1.authors[0].id, b2.authors[0].id);
    });

    it('reuses existing narrator row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Narr Reuse A', narrators: ['Shared Narrator'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Narr Reuse B', narrators: ['Shared Narrator'],
      });
      assert.equal(b1.narrators[0].id, b2.narrators[0].id);
    });

    it('reuses existing translator row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Trans Reuse A', translators: ['Shared Translator'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Trans Reuse B', translators: ['Shared Translator'],
      });
      assert.equal(b1.translators[0].id, b2.translators[0].id);
    });

    it('leaves authors unchanged when key omitted from PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Stable Authors', authors: ['Kept Author'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Stable Authors',
      });
      assert.equal(body.authors.length, 1);
      assert.equal(body.authors[0].name, 'Kept Author');
    });

    it('leaves translators unchanged when key omitted from PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Stable Translators',
        authors: ['Some Author'],
        translators: ['Kept Translator'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Stable Translators',
        authors: ['Some Author'],
      });
      assert.equal(body.translators.length, 1);
      assert.equal(body.translators[0].name, 'Kept Translator');
    });

    it('replaces narrators on PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Narrator Test', narrators: ['Old Voice'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Narrator Test', narrators: ['New Voice'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'New Voice');
    });

    it('replaces translators on PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Translated Book',
        translators: ['Old Translator'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Translated Book',
        translators: ['New Translator A', 'New Translator B'],
      });
      assert.equal(body.translators.length, 2);
      assert.ok(body.translators.every(t => ['New Translator A', 'New Translator B'].includes(t.name)));
      assert.ok(body.translators.every(t => t.name !== 'Old Translator'));
    });

    it('leaves narrators unchanged when key omitted from PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Stable Narrators',
        authors: ['Some Author'],
        narrators: ['Kept Voice'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Stable Narrators',
        authors: ['Some Author'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'Kept Voice');
    });

    it('deduplicates tags case-insensitively', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Tag Dedup', tags: ['sci-fi', 'Sci-Fi', 'SCI-FI'],
      });
      assert.equal(body.tags.length, 1);
    });

    it('reuses existing tag row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Tag Reuse A', tags: ['shared-tag'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Tag Reuse B', tags: ['shared-tag'],
      });
      assert.equal(b1.tags[0].id, b2.tags[0].id);
    });
  });

  describe('read_count on finish transition', () => {
    it('increments read_count when status transitions to finished', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Will Finish', status: 'reading',
      });
      assert.equal(created.read_count, 0);
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Will Finish', status: 'finished',
      });
      assert.equal(body.read_count, 1);
    });

    it('does not increment read_count when already finished', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Already Done', status: 'finished',
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Already Done', status: 'finished',
      });
      assert.equal(body.read_count, created.read_count);
    });

    it('accepts explicit read_count override', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Re-read' });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Re-read', read_count: 5,
      });
      assert.equal(body.read_count, 5);
    });
  });

  describe('PATCH: reading_log and extras', () => {
    let bookId;

    before(async () => {
      const { body } = await req('POST', '/api/books', { title: 'Log Test Book' });
      bookId = body.id;
    });

    it('logs pages_read when current_page increases', async () => {
      await req('PATCH', `/api/books/${bookId}`, { current_page: 50 });
      const { body: log } = await req('GET', `/api/books/${bookId}/log`);
      assert.ok(log.length > 0);
      const entry = log.find(e => e.pages_read >= 50);
      assert.ok(entry, 'expected a log entry with 50 pages');
    });

    it('does not log when current_page does not increase', async () => {
      const { body: before } = await req('GET', `/api/books/${bookId}/log`);
      await req('PATCH', `/api/books/${bookId}`, { current_page: 10 });
      const { body: after } = await req('GET', `/api/books/${bookId}/log`);
      assert.equal(after.length, before.length);
    });

    it('logs minutes_read when current_minutes increases', async () => {
      const { body: audioId } = await req('POST', '/api/books', { title: 'Audio Log' });
      await req('PATCH', `/api/books/${audioId.id}`, { current_minutes: 60 });
      const { body: log } = await req('GET', `/api/books/${audioId.id}/log`);
      assert.ok(log.length > 0);
      assert.ok(log[0].minutes_read >= 60);
    });

    it('patches loved flag', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Loveable' });
      const { body } = await req('PATCH', `/api/books/${b.id}`, { loved: true });
      assert.equal(body.loved, 1);
      const { body: unlovedBody } = await req('PATCH', `/api/books/${b.id}`, { loved: false });
      assert.equal(unlovedBody.loved, 0);
    });

    it('patches fiction flag', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Unknown Genre' });
      assert.equal(b.fiction, null);
      const { body } = await req('PATCH', `/api/books/${b.id}`, { fiction: true });
      assert.equal(body.fiction, 1);
    });

    it('patches acquisition_source', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Source Test' });
      const { body } = await req('PATCH', `/api/books/${b.id}`, { acquisition_source: 'Library' });
      assert.equal(body.acquisition_source, 'Library');
    });
  });

  describe('shelf assignment rules on books', () => {
    let shelfId;
    let roomId;
    let unitId;
    let buildingId;

    before(async () => {
      const { body: b } = await req('POST', '/api/shelf/buildings', { name: 'Rule Test Building' });
      buildingId = b.id;
      const { body: r } = await req('POST', '/api/shelf/rooms', { building_id: buildingId, name: 'Rule Room' });
      roomId = r.id;
      const { body: u } = await req('POST', '/api/shelf/units', { room_id: roomId, name: 'Rule Unit' });
      unitId = u.id;
      const { body: s } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: '1' });
      shelfId = s.id;
    });

    it('shelf_id set: building_id, room_id, unit_id stored as null', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Shelved', shelf_id: shelfId, building_id: buildingId, room_id: roomId, unit_id: unitId,
      });
      assert.equal(body.shelf_id, shelfId);
      assert.equal(body.building_id, null);
      assert.equal(body.room_id, null);
      assert.equal(body.unit_id, null);
    });

    it('unit_id wins over room_id when both present (unit is more specific)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Unit Beats Room', room_id: roomId, unit_id: unitId,
      });
      assert.equal(body.unit_id, unitId);
      assert.equal(body.room_id, null);
      assert.equal(body.shelf_id, null);
      assert.equal(body.building_id, null);
    });

    it('room_id only: unit_id and building_id stored as null', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Room Only', room_id: roomId, building_id: buildingId,
      });
      assert.equal(body.room_id, roomId);
      assert.equal(body.unit_id, null);
      assert.equal(body.shelf_id, null);
      assert.equal(body.building_id, null);
    });

    it('unit_id only (no shelf_id, no room_id): unit_id stored', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Unit Only', unit_id: unitId,
      });
      assert.equal(body.unit_id, unitId);
      assert.equal(body.shelf_id, null);
      assert.equal(body.room_id, null);
      assert.equal(body.building_id, null);
    });
  });

  // Path-traversal hardening for cover_path. The stored value must always be a
  // bare safe filename, otherwise deleteLocalCover() (called on cover replace
  // and book delete) could unlink files outside uploads/.
  describe('cover_path path-traversal protection', () => {
    it('rejects /uploads/.. escape attempts (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Sneaky', cover_path: '/uploads/../../etc/passwd',
      });
      assert.equal(body.cover_path, null);
    });

    it('rejects cover_path missing the /uploads/ prefix (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Bare path', cover_path: '../../etc/passwd',
      });
      assert.equal(body.cover_path, null);
    });

    it('rejects cover_path with a subdirectory under /uploads/ (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Subdir', cover_path: '/uploads/sub/dir/file.webp',
      });
      assert.equal(body.cover_path, null);
    });

    it('accepts a normal /uploads/<filename> and round-trips', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Legit', cover_path: '/uploads/1234567890-abcdef.webp',
      });
      assert.equal(body.cover_path, '/uploads/1234567890-abcdef.webp');
    });

    it('rejects bare "." and ".." filenames (stores null)', async () => {
      // Defence in depth: even though fs.unlink('.') / fs.unlink('..') would
      // EISDIR rather than delete anything, accepting these contradicts the
      // intent of the validator and is easy to bar at the regex level.
      for (const bad of ['/uploads/.', '/uploads/..', '/uploads/.webp', '/uploads/..webp']) {
        const { body } = await req('POST', '/api/books', { title: 'Sneaky', cover_path: bad });
        assert.equal(body.cover_path, null, `expected null for ${bad}`);
      }
    });

    it('rejects non-webp extensions (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Wrong ext', cover_path: '/uploads/1234567890-abcdef.png',
      });
      assert.equal(body.cover_path, null);
    });
  });
});
