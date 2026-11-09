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
    // Nuxt tự import các composable như useRuntimeConfig, defineNuxtConfig.
    files: ['web/**/*.{ts,vue}'],
    rules: { 'no-undef': 'off' },
  },
  {
    // Tên file trong pages/ và layouts/ là route; app.vue, error.vue là tên Nuxt.
    files: ['web/app/{pages,layouts}/**/*.vue', 'web/app/{app,error}.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    // Ô nhập nào cũng phải có nhãn đọc được bằng trình đọc màn hình: label bọc ngoài, label for/id, hoặc aria-label.
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
