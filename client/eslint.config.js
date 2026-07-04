// Minimal lint gate: Rules of Hooks only. The ListDetail TDZ crash
// (1.256.1) and the TodayCard hooks-after-early-return violation both
// built cleanly and shipped — this is the machine check that would have
// caught them at commit time. exhaustive-deps stays off: the codebase
// carries many deliberate, commented dep omissions (useLatest refs,
// stable guards, object-identity avoidance) and a warning wall would
// drown the signal.
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    // Existing eslint-disable-next-line react-hooks/exhaustive-deps
    // comments are dormant while the rule is off, but they document
    // deliberate omissions — don't warn on them.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];
