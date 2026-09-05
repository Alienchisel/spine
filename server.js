import app from './app.js';
import db from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

const PORT = process.env.PORT || 3001;
// Bind to loopback by default so the raw port is never reachable from the
// network — Spine has no auth of its own, so it must only be reachable
// through a trusted front (a same-host reverse proxy / tunnel that
// terminates TLS and gates access). Set HOST=0.0.0.0 to deliberately
// expose it on all interfaces (only sound behind a firewall or an
// authenticating proxy).
const HOST = process.env.HOST || '127.0.0.1';

const server = app.listen(PORT, HOST, () => console.log(`Spine running on http://${HOST}:${PORT}`));

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
