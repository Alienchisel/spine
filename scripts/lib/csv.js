// Minimal RFC 4180 CSV parser for the Amazon / Audible / Kindle export
// importers (it was copied into four scripts). Handles quoted fields,
// escaped quotes (""), commas and newlines inside quotes, and CRLF line
// endings. A leading byte-order mark is stripped — only the Kindle copy
// did that, but any export can carry one, and with it the first header
// reads as "\uFEFFDate" and a by-name column lookup silently misses.
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"')                   { inQuote = false; }
      else                                  { field += c; }
    } else {
      if (c === '"')        { inQuote = true; }
      else if (c === ',')   { row.push(field); field = ''; }
      else if (c === '\r')  { /* skip */ }
      else if (c === '\n')  { row.push(field); field = ''; rows.push(row); row = []; }
      else                  { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
