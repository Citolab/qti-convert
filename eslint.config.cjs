const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['.cache/**', 'dist/**', 'node_modules/**', 'scripts/**', 'vite.config.ts']
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        AbortController: 'readonly',
        Blob: 'readonly',
        Buffer: 'readonly',
        Document: 'readonly',
        DocumentFragment: 'readonly',
        DOMParser: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        NodeJS: 'readonly',
        Storage: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        XMLDocument: 'readonly',
        btoa: 'readonly',
        caches: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-async-promise-executor': 'off',
      'no-debugger': 'off',
      'no-irregular-whitespace': 'off',
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
];
