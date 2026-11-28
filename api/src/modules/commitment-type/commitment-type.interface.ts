import type { DbClient } from '../../core/db.ts'
import type { CommitmentType } from '../../generated/prisma/client.ts'

/** What other modules may ask of this one. */
export interface ICommitmentTypeQuery {
  getItem(id: string, db?: DbClient): Promise<CommitmentType>
}
