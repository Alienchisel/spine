import app from './app.js';
import db from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => console.log(`Spine running on http://localhost:${PORT}`));

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
