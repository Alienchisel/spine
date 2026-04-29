import { realTagNames } from '../../utils.js';

export function bookToFormState(book) {
  return {
    title: book.title,
    authors: book.authors?.map(a => a.name) || [],
    status: book.status,
    owned: Boolean(book.owned),
    previously_owned: Boolean(book.previously_owned),
    shelf_id: book.shelf_id ?? null,
    building_id: book.building_id ?? null,
    room_id: book.room_id ?? null,
    unit_id: book.unit_id ?? null,
    is_custom: Boolean(book.is_custom),
    fiction: book.fiction === null || book.fiction === undefined ? null : Boolean(book.fiction),
    source_type: book.source_type || '',
    rating: book.rating ?? null,
    date_started: book.date_started || '',
    date_finished: book.date_finished || '',
    language: book.language || 'English',
    original_language: book.original_language || '',
    translator: book.translator || '',
    publisher: book.publisher || '',
    series: book.series || '',
    series_number: book.series_number ?? '',
    acquisition_source: book.acquisition_source || '',
    acquisition_date: book.acquisition_date || '',
    isbn_10: book.isbn_10 || '',
    isbn_13: book.isbn_13 || '',
    asin: book.asin || '',
    year_published: book.year_published ?? '',
    year_approximate: Boolean(book.year_approximate),
    year_edition: book.year_edition ?? '',
    description: book.description || '',
    format: book.format || '',
    binding: book.binding || '',
    condition: book.condition || '',
    page_count: book.page_count ?? '',
    current_page: book.current_page ?? '',
    duration_minutes: book.duration_minutes ?? '',
    narrators: book.narrators?.map(n => n.name) || [],
    notes: book.notes || '',
    review: book.review || '',
    read_count: book.read_count || 0,
    tags: realTagNames(book.tags),
    cover_path: book.cover_path || null,
  };
}

// Merge any pending chip-input text (typed but not yet Enter-confirmed) into the
// list before serialising; otherwise users would lose work when hitting Save.
function mergePending(list, pending) {
  const t = pending.trim().replace(/,$/, '');
  return t && !list.includes(t) ? [...list, t] : list;
}

export function formStateToPayload(form, { tagInput, narratorInput, authorInput }) {
  return {
    ...form,
    tags:      mergePending(form.tags,      tagInput),
    narrators: mergePending(form.narrators, narratorInput),
    authors:   mergePending(form.authors,   authorInput),
    title: form.title.trim(),
    date_started:      form.date_started || null,
    date_finished:     form.date_finished || null,
    acquisition_source: form.acquisition_source || null,
    notes:             form.notes || null,
    page_count:        form.page_count       ? parseInt(form.page_count)       : null,
    duration_minutes:  form.duration_minutes ? parseInt(form.duration_minutes) : null,
    year_published:    form.year_published   ? parseInt(form.year_published)   : null,
    year_edition:      form.year_edition     ? parseInt(form.year_edition)     : null,
    year_approximate:  form.year_edition     ? form.year_approximate           : false,
    series_number:     form.series_number !== '' ? parseFloat(form.series_number) : null,
  };
}
