import { Router } from 'express'
import { z } from 'zod'
import {
  CommitmentTypeRequest,
  ErrorCode,
  type CommitmentType as CommitmentTypeBody,
  type CommitmentTypeList,
} from '@ecommerce/shared'
import { audited } from '../core/audit/audited.ts'
import { requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import type { CommitmentType } from '../generated/prisma/client.ts'
import { AppError, conflictField, rethrowUnique } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'
import { contextOf } from '../core/context/request-context.ts'

const TypeParams = z.object({ id: z.uuid() })

const toBody = ({ id, name, kind }: CommitmentType): CommitmentTypeBody => ({ id, name, kind })
const auditFields = ({ name, kind }: CommitmentType) => ({ name, kind })

const nameTaken = () => conflictField('name', 'Đã có loại cam kết cùng tên')

/**
 * Closed list of commitment types. Anyone editing products or viewing documents can read it; adding or editing needs
 * `commitment.edit`. No delete: recorded commitments always point to an existing type.
 */
export function adminCommitmentTypeRoutes(prisma: Db) {
  return Router()
    .get(
      '/',
      requirePermission('catalog.edit', 'price.edit', 'document.view', 'commitment.edit'),
      async (_req, res) => {
        const types = await prisma.commitmentType.findMany({ orderBy: { name: 'asc' } })
        const body: CommitmentTypeList = { items: types.map(toBody) }
        res.json(body)
      },
    )
    .post('/', requirePermission('commitment.edit'), async (req, res) => {
      const input = parse(CommitmentTypeRequest, req.body)
      const created = await audited(prisma, contextOf(req), async (tx, audit) => {
        const row = await tx.commitmentType.create({ data: input })
        await audit({
          action: 'commitment_type.create',
          entityType: 'commitment_type',
          entityId: row.id,
          after: auditFields(row),
        })
        return row
      }).catch(rethrowUnique(nameTaken))
      res.status(201).json(toBody(created))
    })
    .put('/:id', requirePermission('commitment.edit'), async (req, res) => {
      const { id } = parse(TypeParams, req.params)
      const input = parse(CommitmentTypeRequest, req.body)
      const updated = await audited(prisma, contextOf(req), async (tx, audit) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "commitment_type" WHERE "id" = ${id}::uuid FOR UPDATE`
        if (!locked) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy loại cam kết')
        const before = await tx.commitmentType.findUniqueOrThrow({ where: { id } })
        if (before.name === input.name && before.kind === input.kind) return before
        const after = await tx.commitmentType.update({ where: { id }, data: input })
        await audit({
          action: 'commitment_type.update',
          entityType: 'commitment_type',
          entityId: id,
          before: auditFields(before),
          after: auditFields(after),
        })
        return after
      }).catch(rethrowUnique(nameTaken))
      res.json(toBody(updated))
    })
}
