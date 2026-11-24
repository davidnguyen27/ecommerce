import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  target: 'node24',
  // shared is TS source in the workspace, so it must be bundled.
  noExternal: ['@ecommerce/shared'],
  clean: true,
})
