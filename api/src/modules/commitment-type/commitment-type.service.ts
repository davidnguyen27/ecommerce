import { ErrorCode } from '@ecommerce/shared'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError, conflictField, rethrowUnique } from '../../core/errors.ts'
import { BaseCrudService } from '../../core/service/base-crud.service.ts'
import type { CommitmentType, Prisma } from '../../generated/prisma/client.ts'
import type { CommitmentTypeInput } from './dto/index.ts'
import type { ICommitmentTypeQuery } from './commitment-type.interface.ts'
import { commitmentTypeAuditFields } from './commitment-type.mapper.ts'
import type { CommitmentTypeRepository } from './commitment-type.repository.ts'

const nameTaken = () => conflictField('name', 'Đã có loại cam kết cùng tên')

/** Closed list of commitment types. No delete: recorded commitments always point to an existing type. */
export class CommitmentTypeService
  extends BaseCrudService<CommitmentType, CommitmentTypeInput, CommitmentTypeInput>
  implements ICommitmentTypeQuery
{
  protected readonly entityType = 'commitment_type'
  protected readonly actions = { create: 'commitment_type.create', update: 'commitment_type.update' }

  constructor(
    prisma: Db,
    protected override readonly repo: CommitmentTypeRepository,
  ) {
    super(prisma, repo)
  }

  protected snapshot(row: CommitmentType): Prisma.InputJsonValue {
    return commitmentTypeAuditFields(row)
  }

  protected override notFound() {
    return new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy loại cam kết')
  }

  list() {
    return this.repo.findAllByName(this.prisma)
  }

  override async create(input: CommitmentTypeInput, ctx: RequestContext) {
    return super.create(input, ctx).catch(rethrowUnique(nameTaken))
  }

  /** The same name and kind write nothing. */
  override async update(id: string, input: CommitmentTypeInput, ctx: RequestContext) {
    return this.updateWith(id, ctx, this.actions.update, async (_tx, current) =>
      current.name === input.name && current.kind === input.kind ? null : input,
    ).catch(rethrowUnique(nameTaken))
  }
}
