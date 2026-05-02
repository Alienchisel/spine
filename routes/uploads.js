import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { saveCoverFromBuffer } from '../lib/books/covers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../uploads');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'));
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
  const { url } = req.body;
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (parsed.protocol !== 'https:') return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch cover' });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return res.status(400).json({ error: 'URL does not point to an image' });
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    if (contentLength > 10 * 1024 * 1024) return res.status(400).json({ error: 'Image too large' });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'Image too large' });
    const filename = await saveCoverFromBuffer(buffer);
    res.json({ path: `/uploads/${filename}` });
  } catch {
    res.status(500).json({ error: 'Failed to process cover' });
  }
});

export default router;
