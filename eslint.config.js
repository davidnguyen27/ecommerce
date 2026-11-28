import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import pluginVueA11y from 'eslint-plugin-vuejs-accessibility'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.output/',
      '**/.nuxt/',
      'api/src/generated/',
      '.agents/',
      '.claude/',
      '**/test-results/',
      '**/playwright-report/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // ADR 0018: a module reaches another only through that module's index.ts (its Module and query interfaces).
    files: ['api/src/modules/**/*.ts'],
    ignores: ['api/src/modules/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./(?!\\.\\.)[^/]+/(?!index\\.ts$).+',
              message: 'Import another module only from its index.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // ADR 0018: core is the shared base under every module, so it never imports one.
    files: ['api/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '/modules/', message: 'core/ must not import modules; pass what it needs in.' }] },
      ],
    },
  },
  {
    // Nuxt auto-imports composables like useRuntimeConfig, defineNuxtConfig.
    files: ['web/**/*.{ts,vue}'],
    rules: { 'no-undef': 'off' },
  },
  {
    // File names in pages/ and layouts/ are routes; app.vue, error.vue are Nuxt names.
    files: ['web/app/{pages,layouts}/**/*.vue', 'web/app/{app,error}.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    // Every input needs a screen-reader-readable label: a wrapping label, label for/id, or aria-label.
    files: ['web/**/*.vue'],
    plugins: { 'vuejs-accessibility': pluginVueA11y },
    rules: {
      'vuejs-accessibility/form-control-has-label': 'error',
      'vuejs-accessibility/label-has-for': [
        'error',
        { required: { some: ['nesting', 'id'] }, controlComponents: ['AttributeInput'] },
      ],
    },
  },
)
