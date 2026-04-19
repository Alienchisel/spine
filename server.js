import app from './app.js';
import db from './db.js';

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
