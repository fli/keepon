import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import prettierConfig from 'eslint-config-prettier'

const tsConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: config.files ?? ['**/*.{ts,tsx,cts,mts}'],
  languageOptions: {
    ...config.languageOptions,
    parserOptions: {
      ...config.languageOptions?.parserOptions,
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
}))

const rootNext = nextCoreWebVitals.map((config) => ({
  ...config,
  settings: {
    ...(config.settings ?? {}),
    react: {
      ...(config.settings?.react ?? {}),
      version: '19.2',
    },
    next: {
      ...(config.settings?.next ?? {}),
      rootDir: ['.'],
    },
  },
}))

export default defineConfig([
  {
    name: 'keepon-solito/javascript',
    ...js.configs.recommended,
    settings: {
      react: {
        version: '19.2',
      },
    },
  },
  ...tsConfigs,
  {
    name: 'keepon-solito/ts-tweaks',
    files: ['**/*.{ts,tsx,cts,mts}'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    name: 'keepon-solito/dts',
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
  {
    name: 'keepon-solito/node-configs',
    files: [
      '**/*.config.{js,cjs,mjs}',
      '**/babel.config.js',
      '**/next.config.js',
      '**/tailwind.config.{js,cjs,mjs}',
    ],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
      },
    },
  },
  ...rootNext,
  {
    name: 'keepon-solito/next-app-router-rules',
    files: ['src/app/**/*.{js,jsx,ts,tsx,mjs,cts,mts}'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  prettierConfig,
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/dist/**',
    '**/build/**',
    '**/.output/**',
  ]),
])
