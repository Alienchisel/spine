import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { saveCoverFromBuffer, downloadCoverByUrl, CoverFetchError } from '../lib/books/covers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../uploads');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      const err = new Error('Only images allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

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
