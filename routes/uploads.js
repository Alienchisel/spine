import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import sharp from 'sharp';

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

function randomFilename() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
}

async function saveResized(buffer) {
  const filename = randomFilename();
  const dest = path.join(uploadsDir, filename);
  await sharp(buffer)
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(dest);
  return `/uploads/${filename}`;
}

const router = express.Router();

router.post('/', upload.single('cover'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const filePath = await saveResized(req.file.buffer);
    res.json({ path: filePath });
  } catch {
    res.status(500).json({ error: 'Failed to process image' });
  }
});

router.post('/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url?.startsWith('https://covers.openlibrary.org/')) {
    return res.status(400).json({ error: 'Invalid cover URL' });
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch cover' });
    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = await saveResized(buffer);
    res.json({ path: filePath });
  } catch {
    res.status(500).json({ error: 'Failed to process cover' });
  }
});

export default router;
