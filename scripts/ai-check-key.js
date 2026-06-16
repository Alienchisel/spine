// Diagnostic — prints non-sensitive metadata about the loaded API key
// so we can tell whether the .env line is malformed. Never echoes the
// secret portion. Run with: node --env-file=.env scripts/ai-check-key.js

const k = process.env.ANTHROPIC_API_KEY;

if (!k) {
  console.log('present: false  (env var not loaded — check .env exists at repo root)');
  process.exit(1);
}

const trimmed = k.trim();
const hasOuterQuotes = /^["'].*["']$/.test(k);
const hasLeadingExport = k.startsWith('export ');

console.log('present:         true');
console.log('length:          ', k.length);
console.log('starts with:     ', k.slice(0, 7));
console.log('ends with:       ', '...' + k.slice(-4));
console.log('leading whitespace?', k !== k.trimStart());
console.log('trailing whitespace?', k !== k.trimEnd());
console.log('wrapped in quotes? ', hasOuterQuotes);
console.log('has "export "?     ', hasLeadingExport);
console.log('length when trimmed:', trimmed.length);
console.log();
console.log('Expected: length ~108, starts with "sk-ant-", no quotes, no leading export.');
