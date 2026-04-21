import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import booksRouter from './routes/books.js';
import uploadsRouter from './routes/uploads.js';
import searchRouter from './routes/search.js';
import readlistRouter from './routes/readlist.js';
import listsRouter from './routes/lists.js';
import diaryRouter from './routes/diary.js';
import statsRouter from './routes/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/books', booksRouter);
app.use('/api/upload', uploadsRouter);
app.use('/api/search', searchRouter);
app.use('/api/readlist', readlistRouter);
app.use('/api/lists', listsRouter);
app.use('/api/diary', diaryRouter);
app.use('/api/stats', statsRouter);

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
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

export default app;
