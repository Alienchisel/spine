import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import booksRouter from './routes/books.js';
import uploadsRouter from './routes/uploads.js';
import searchRouter from './routes/search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/books', booksRouter);
app.use('/api/upload', uploadsRouter);
app.use('/api/search', searchRouter);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
  });
}

app.listen(PORT, () => console.log(`Spine running on http://localhost:${PORT}`));
