import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import booksRouter from './routes/books.js';
import authorsRouter from './routes/authors.js';
import uploadsRouter from './routes/uploads.js';
import searchRouter from './routes/search.js';
import readlistRouter from './routes/readlist.js';
import listsRouter from './routes/lists.js';
import diaryRouter from './routes/diary.js';
import statsRouter from './routes/stats.js';
import collageRouter from './routes/collage.js';
import settingsRouter from './routes/settings.js';
import shelfRouter from './routes/shelf.js';
import tagsRouter from './routes/tags.js';
import seriesRouter from './routes/series.js';
import todayRouter from './routes/today.js';
import { bumpDataVersion, getDataVersion } from './lib/dataVersion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Any successful mutation bumps the data version (see lib/dataVersion.js).
// Method-based rather than per-route so new routers are covered by
// default; 'finish' + status check means failed writes don't bump.
// Known blind spot: GET /api/today/card persists the day's card as a
// side effect — harmless, since every device converges on the same
// persisted row for a given date anyway.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => { if (res.statusCode < 400) bumpDataVersion(); });
  }
  next();
});
app.get('/api/version', (_req, res) => {
  res.json({ version: getDataVersion() });
});

app.use('/api/books', booksRouter);
app.use('/api/authors', authorsRouter);
app.use('/api/upload', uploadsRouter);
app.use('/api/search', searchRouter);
app.use('/api/readlist', readlistRouter);
app.use('/api/lists', listsRouter);
app.use('/api/diary', diaryRouter);
app.use('/api/stats', statsRouter);
app.use('/api/collage', collageRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/shelf', shelfRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/series', seriesRouter);
app.use('/api/today', todayRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  // Multer's built-in errors (file size limits, etc.) carry a code and a
  // useful message. Surface them as 400 instead of swallowing into a 500.
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  // Errors that explicitly tag themselves with a status get their message
  // surfaced too — used by the multipart fileFilter for "Only images allowed".
  if (err && err.status && err.message) {
    return res.status(err.status).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
