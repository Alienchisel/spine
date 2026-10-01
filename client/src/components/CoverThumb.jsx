import { toThumbUrl } from '../utils.js';

// <img> for a book cover shown at tile / list size (anything up to ~200 CSS
// px wide). Serves the /uploads/thumbs/{stem}.jpg variant — max 400 px,
// ~47 KB against an ~880 KB average original — and falls back to the
// original once if the thumb is missing (pre-backfill covers, or thumb
// generation failed on ingest). Before this, list surfaces put originals
// into 32–160 px tiles: Diary alone pulled ~20 MB of images per load.
// Lazy + async decode so off-screen rows in long lists don't load up front.
// Keep the original (a plain <img src={cover_path}>) only where the cover
// is shown large: BookDetail's main cover and its lightbox.
export default function CoverThumb({ src, ...rest }) {
  return (
    <img
      loading="lazy"
      decoding="async"
      {...rest}
      src={toThumbUrl(src)}
      // One retry, then stop: compare pathnames because currentTarget.src
      // is absolute while src is the stored relative path.
      onError={(e) => {
        const current = new URL(e.currentTarget.src, window.location.origin).pathname;
        if (src && current !== src) e.currentTarget.src = src;
      }}
    />
  );
}
