import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` needs no URL; migrate does.
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
