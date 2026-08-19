// Server-side lint gate. The client has its own minimal config
// (client/eslint.config.js, Rules-of-Hooks only); this one covers the
// ~9k lines of Node code — server.js/app.js/db.js/ingest.js, routes/,
// lib/, shared/, scripts/, test/ — that previously got zero static
// analysis. Scope is eslint:recommended: the bug-catchers (no-undef,
// no-unused-vars, no-unreachable, no-dupe-keys, no-constant-condition,
// …), not stylistic noise. Same philosophy as the client gate — catch
// the classes of mistake that build cleanly and ship, nothing that
// would build a warning wall.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Client has its own config; these are generated/vendored or data.
    ignores: [
      'client/**',
      'node_modules/**',
      'dist/**',
      'backups/**',
      'uploads/**',
      '.tools/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Unused args are often deliberate (Express middleware signatures
      // like (req, res, next), destructured-and-dropped fields). Only
      // flag args before the last used one, and let a leading _ opt out
      // — for both args and vars, matching the codebase's own `_omit`
      // convention. Caught errors are frequently intentionally ignored.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // Best-effort cleanup in tests uses `catch {}` deliberately — a
      // failed unlink/rmdir on teardown shouldn't fail the test.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
