import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from './generated/prisma/client.ts'

export type Db = PrismaClient
/** Client trong `$transaction`, hoặc client thường khi không cần transaction. */
export type DbClient = Db | Prisma.TransactionClient

/** `maxConnections` bỏ trống thì dùng mặc định của pg (10). */
export function createPrisma(databaseUrl: string, options: { maxConnections?: number } = {}): Db {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: options.maxConnections,
  })
  return new PrismaClient({ adapter })
}
