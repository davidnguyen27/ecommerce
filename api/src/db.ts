import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from './generated/prisma/client.ts'

export type Db = PrismaClient
/** Client trong `$transaction`, hoặc client thường khi không cần transaction. */
export type DbClient = Db | Prisma.TransactionClient

export function createPrisma(databaseUrl: string): Db {
  const adapter = new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  return new PrismaClient({ adapter })
}
