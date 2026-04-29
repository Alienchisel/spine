import { sortTitle } from '../../utils.js';

export function sortVolumes(books) {
  return [...books].sort((a, b) =>
    (a.series_number ?? Infinity) - (b.series_number ?? Infinity) || sortTitle(a.title).localeCompare(sortTitle(b.title))
  );
}

// Walks the books list and folds multi-volume series into a single 'series'
// item that can be expanded inline. Single-volume series stay as plain books.
export function buildDisplayItems(books, expandedSeries) {
  const seriesGroups = new Map();
  for (const book of books) {
    if (book.series) {
      if (!seriesGroups.has(book.series)) seriesGroups.set(book.series, []);
      seriesGroups.get(book.series).push(book);
    }
  }
  const seenSeries = new Set();
  const items = [];
  for (const book of books) {
    if (book.series && seriesGroups.get(book.series).length > 1) {
      if (!seenSeries.has(book.series)) {
        seenSeries.add(book.series);
        const groupBooks = seriesGroups.get(book.series);
        items.push({ type: 'series', name: book.series, books: groupBooks });
        if (expandedSeries.has(book.series)) {
          for (const vol of sortVolumes(groupBooks)) {
            items.push({ type: 'book', book: vol });
          }
        }
      }
    } else {
      items.push({ type: 'book', book });
    }
  }
  return items;
}
