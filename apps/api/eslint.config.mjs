import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'eslint.config.mjs', 'jest.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Module boundaries (docs/ARCHITECTURE.md §2.2): never reach into another module's repository.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/modules/*/*.repository', '../*/*.repository'], message: 'Use the owning module service, not its repository.' }] },
      ],
    },
  },
);
