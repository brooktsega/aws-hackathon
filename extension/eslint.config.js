import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // R11.5: dynamic strings must never be parsed as HTML.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent or the h() helper (R11.5).' },
        { property: 'outerHTML', message: 'Use textContent or the h() helper (R11.5).' },
        { property: 'insertAdjacentHTML', message: 'Use textContent or the h() helper (R11.5).' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } },
  },
);
