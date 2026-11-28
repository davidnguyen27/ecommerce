import { EMPTY_LEGAL_INFO, LegalInfo } from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db, DbClient } from '../../core/db.ts'
import type { LegalInfoRepository } from './legal-info.repository.ts'

/** The shop's legal info for the website footer; edited like published content, audited. */
export class LegalInfoService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: LegalInfoRepository,
  ) {}

  /** Fields never saved (new ones included) are empty. */
  async get(db: DbClient = this.prisma): Promise<LegalInfo> {
    return LegalInfo.parse({ ...EMPTY_LEGAL_INFO, ...((await this.repo.find(db)) as object | undefined) })
  }

  /** Saves under a lock; no change, no write. */
  save(input: LegalInfo, ctx: RequestContext): Promise<LegalInfo> {
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.repo.lock(tx)
      const before = await this.get(tx)
      // Both go through the same schema, so the same key order.
      if (JSON.stringify(before) === JSON.stringify(input)) return before
      await this.repo.save(tx, input)
      await audit({
        action: 'legal_info.change',
        entityType: 'system_config',
        entityId: this.repo.key,
        before,
        after: input,
      })
      return input
    })
  }
}
