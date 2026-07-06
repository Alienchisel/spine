import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      output: {
        // Pin the always-loaded framework libraries into one chunk so
        // the entry chunk is mostly app code. App code changes every
        // release (version bump busts its hash) while these libs change
        // only on dependency upgrades — splitting them keeps the big
        // chunk long-lived in browser cache. Deliberately NOT a broad
        // node_modules catch-all: that would merge lazy-only weight
        // (recharts, html2canvas-pro, react-markdown) into the same
        // chunk the entry needs for react, dragging it all back onto
        // the cold-load path.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor';
          if (/node_modules\/(react-router|react-router-dom|@remix-run)\//.test(id)) return 'vendor';
          if (/node_modules\/@tanstack\//.test(id)) return 'vendor';
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
});
