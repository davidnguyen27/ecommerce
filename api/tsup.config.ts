import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  target: 'node24',
  // shared là mã nguồn TS trong workspace nên phải gộp vào bundle.
  noExternal: ['@ecommerce/shared'],
  clean: true,
})
