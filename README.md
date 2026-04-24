# Spine

A personal library manager. Track your books, reading progress, shelves, diary entries, lists, and stats.

## Requirements

- Node.js 18 or later
- npm

## Setup

```bash
npm run setup
npm start
```

The app runs at [http://localhost:3001](http://localhost:3001). The database and uploads directory are created automatically on first run.

`npm run setup` installs all dependencies and builds the frontend in one step.

## Development

Run the server and client dev servers concurrently with hot reload:

```bash
npm run dev
```

The client dev server proxies API requests to `localhost:3001`.

## Ingester

Add books by Amazon URL or ISBN from the command line:

```bash
node ingest.js 9780465038565
node ingest.js https://www.amazon.com/dp/0465038565
```

By default the ingester posts to `http://localhost:3001`. Override with:

```bash
SPINE_URL=http://your-host:3001 node ingest.js <isbn>
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `DB_PATH` | `./spine.db` | Path to the SQLite database file |

## Troubleshooting

`sharp` and `better-sqlite3` are native modules that compile against your local Node/OS during `npm install`. If the setup fails, make sure you have the required build tools:

**Linux (Debian/Ubuntu):**
```bash
sudo apt install python3 make g++
```

**macOS:**
```bash
xcode-select --install
```

**Windows:** Install the [Windows Build Tools](https://github.com/nodejs/node-gyp#on-windows) via node-gyp's instructions.

## Data

- **Database**: `spine.db` (SQLite, created automatically)
- **Covers**: `uploads/` (created automatically)
- **Backups**: `backup.sh` produces dated copies in `backups/`
