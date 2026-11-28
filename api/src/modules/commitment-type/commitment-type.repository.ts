import type { DbClient } from '../../core/db.ts'
import { BaseRepository, type ModelDelegate } from '../../core/repository/base.repository.ts'
import type { CommitmentType } from '../../generated/prisma/client.ts'
import type { CommitmentTypeInput } from './dto/index.ts'

export class CommitmentTypeRepository extends BaseRepository<CommitmentType, CommitmentTypeInput, CommitmentTypeInput> {
  protected readonly table = 'commitment_type'

  protected model(db: DbClient): ModelDelegate<CommitmentType, CommitmentTypeInput, CommitmentTypeInput> {
    return db.commitmentType
  }

  findAllByName(db: DbClient) {
    return db.commitmentType.findMany({ orderBy: { name: 'asc' } })
  }
}
