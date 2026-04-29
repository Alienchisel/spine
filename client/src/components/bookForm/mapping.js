import { realTagNames } from '../../utils.js';
import { INTEGER_FIELDS, FLOAT_FIELDS } from '../../../../shared/bookFields.js';

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
    translators: book.translators?.map(t => t.name) || [],
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
    abridged: Boolean(book.abridged),
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

// Form state holds these as strings ('' when blank); the API expects null or
// a real value. Listed here so adding a new nullable scalar means one edit.
const NULLABLE_STRINGS_ON_SAVE = ['date_started', 'date_finished', 'acquisition_source', 'notes'];

export function formStateToPayload(form, { tagInput, narratorInput, authorInput, translatorInput }) {
  const out = { ...form };

  out.authors     = mergePending(form.authors,     authorInput);
  out.narrators   = mergePending(form.narrators,   narratorInput);
  out.translators = mergePending(form.translators, translatorInput);
  out.tags        = mergePending(form.tags,        tagInput);

  out.title = form.title.trim();

  for (const f of NULLABLE_STRINGS_ON_SAVE) {
    out[f] = form[f] || null;
  }

  for (const f of INTEGER_FIELDS) {
    out[f] = form[f] === '' || form[f] == null ? null : parseInt(form[f]);
  }

  for (const f of FLOAT_FIELDS) {
    out[f] = form[f] === '' || form[f] == null ? null : parseFloat(form[f]);
  }

  // year_approximate is only meaningful when year_edition is set.
  out.year_approximate = form.year_edition ? form.year_approximate : false;

  return out;
}
