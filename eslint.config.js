import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['server/**/*.js', '**/*.test.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['server/server.js'],
    rules: {
      // Regression tests execute this helper by name inside a VM, outside ESLint's reference graph.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^getSimumuangRange$',
        reportUsedIgnorePattern: true,
      }],
    },
  },
])
