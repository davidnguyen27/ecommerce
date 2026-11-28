import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from '../generated/prisma/client.ts'

export type Db = PrismaClient
/** Client inside `$transaction`, or the plain client when no transaction is needed. */
export type DbClient = Db | Prisma.TransactionClient

/** Empty `maxConnections` uses pg's default (10). */
export function createPrisma(databaseUrl: string, options: { maxConnections?: number } = {}): Db {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: options.maxConnections,
  })
  return new PrismaClient({ adapter })
}
