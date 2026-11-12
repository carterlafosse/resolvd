// ESLint flat config for the Node.js (ES modules) API.
import js from '@eslint/js';
import globals from 'globals';

export default [
  // Never lint installed packages or generated output.
  { ignores: ['node_modules/', 'coverage/', 'dist/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
