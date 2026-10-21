import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.ts'

export type Db = PrismaClient

export function createPrisma(databaseUrl: string): Db {
  const adapter = new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  return new PrismaClient({ adapter })
}
