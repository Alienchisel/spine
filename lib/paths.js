import path from 'path';
import { fileURLToPath } from 'url';

// Where uploaded covers and author portraits live — one definition for the
// server and the maintenance scripts (it used to be recomputed in seven
// places). Thumbs are derived max-400px JPGs beside each originals dir.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOADS_DIR       = path.join(root, 'uploads');
export const COVER_THUMBS_DIR  = path.join(UPLOADS_DIR, 'thumbs');
export const AUTHOR_PHOTOS_DIR = path.join(UPLOADS_DIR, 'authors');
export const AUTHOR_THUMBS_DIR = path.join(AUTHOR_PHOTOS_DIR, 'thumbs');
