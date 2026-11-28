import type { DbClient } from '../../core/db.ts'
import type { Brand } from '../../generated/prisma/client.ts'

/** What other modules may ask of this one. */
export interface IBrandQuery {
  getItem(id: string, db?: DbClient): Promise<Brand>
}
