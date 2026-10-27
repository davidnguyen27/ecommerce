import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/.output/', '**/.nuxt/', 'api/src/generated/', '.agents/', '.claude/'],
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
    // Tên file trong pages/ và layouts/ là route; app.vue, error.vue là tên Nuxt; components/ui là Shadcn UI primitives.
    files: ['web/app/{pages,layouts}/**/*.vue', 'web/app/{app,error}.vue', 'web/app/components/ui/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
)
