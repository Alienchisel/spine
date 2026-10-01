import express from 'express';
import fs from 'fs';
import { saveCoverFromBuffer, downloadCoverByUrl, CoverFetchError } from '../lib/books/covers.js';
import { imageUpload } from '../lib/images.js';
import { UPLOADS_DIR } from '../lib/paths.js';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Shared multipart image config (lib/images.js): in-memory, 10 MB cap, image/* only.
const upload = imageUpload;

const router = express.Router();

router.post('/', upload.single('cover'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const filename = await saveCoverFromBuffer(req.file.buffer);
    res.json({ path: `/uploads/${filename}` });
  } catch {
    res.status(500).json({ error: 'Failed to process image' });
  }
});

router.post('/fetch', async (req, res) => {
  try {
    const filename = await downloadCoverByUrl(req.body?.url);
    res.json({ path: `/uploads/${filename}` });
  } catch (err) {
    if (err instanceof CoverFetchError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Failed to process cover' });
  }
});

export default router;
