import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import expoFlat from 'eslint-config-expo/flat.js'
import prettierConfig from 'eslint-config-prettier'
import reactCompiler from 'eslint-plugin-react-compiler'
import reactNativePlugin from '@react-native/eslint-plugin'

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

const scopedNext = nextCoreWebVitals.map((config) => {
  if (config.ignores) {
    return {
      ...config,
      ignores: config.ignores.map((pattern) => `apps/next/${pattern}`),
    }
  }

  const files =
    config.files ?? ['**/*.{js,jsx,ts,tsx,mts,cts}', '**/*.d.ts', '**/*.d.cts']

  return {
    ...config,
    files: files.map((pattern) =>
      pattern.startsWith('**/')
        ? `apps/next/${pattern}`
        : pattern.startsWith('*.')
          ? `apps/next/${pattern}`
          : `apps/next/${pattern}`,
    ),
    settings: {
      ...(config.settings ?? {}),
      react: {
        ...(config.settings?.react ?? {}),
        version: '19.2',
      },
      next: {
        ...(config.settings?.next ?? {}),
        rootDir: ['apps/next/'],
      },
    },
  }
})

const expoRoots = ['apps/expo', 'packages/app']
const scopeToExpo = (patterns) =>
  expoRoots.flatMap((root) =>
    patterns.map((pattern) =>
      pattern.startsWith('**/')
        ? `${root}/${pattern}`
        : pattern.startsWith('*.')
          ? `${root}/${pattern}`
          : `${root}/${pattern}`,
    ),
  )

const scopedExpo = expoFlat.map((config) => {
  const files =
    config.files ?? ['**/*.{js,jsx,ts,tsx,mts,cts}', '**/*.d.ts', '*.config.js']

  const scoped = {
    ...config,
    files: scopeToExpo(files),
  }
  scoped.settings = {
    ...(config.settings ?? {}),
    react: {
      ...(config.settings?.react ?? {}),
      version: '19.2',
    },
  }
  if (config.ignores) {
    scoped.ignores = scopeToExpo(config.ignores)
  }
  return scoped
})

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
      '**/metro.config.js',
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
  ...scopedNext,
  ...scopedExpo,
  {
    name: 'keepon-solito/react-compiler',
    files: [
      'apps/expo/**/*.{js,jsx,ts,tsx}',
      'packages/app/**/*.{js,jsx,ts,tsx}',
    ],
    plugins: {
      'react-compiler': reactCompiler,
    },
    rules: reactCompiler.configs.recommended.rules,
  },
  {
    name: 'keepon-solito/react-native',
    files: [
      'apps/expo/**/*.{js,jsx,ts,tsx}',
      'packages/app/**/*.{js,jsx,ts,tsx}',
    ],
    plugins: {
      '@react-native': reactNativePlugin,
    },
    rules: {
      '@react-native/no-deep-imports': 'error',
    },
  },
  {
    name: 'keepon-solito/import-core-modules',
    files: [
      'apps/expo/**/*.{js,jsx,ts,tsx}',
      'packages/app/**/*.{js,jsx,ts,tsx}',
      'packages/app/**/*.d.ts',
    ],
    settings: {
      'import/core-modules': ['react', 'react-native'],
    },
  },
  {
    name: 'keepon-solito/rn-unsafe-any',
    files: [
      'apps/expo/**/*.{ts,tsx}',
      'packages/app/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  prettierConfig,
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/.expo/**',
    '**/.turbo/**',
    '**/dist/**',
    '**/build/**',
    '**/.output/**',
  ]),
])
