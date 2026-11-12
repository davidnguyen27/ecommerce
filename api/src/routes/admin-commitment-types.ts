import { Router } from 'express'
import { z } from 'zod'
import {
  CommitmentTypeRequest,
  ErrorCode,
  type CommitmentType as CommitmentTypeBody,
  type CommitmentTypeList,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { CommitmentType } from '../generated/prisma/client.ts'
import { AppError, conflictField, rethrowUnique } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

const TypeParams = z.object({ id: z.uuid() })

const toBody = ({ id, name, kind }: CommitmentType): CommitmentTypeBody => ({ id, name, kind })
const auditFields = ({ name, kind }: CommitmentType) => ({ name, kind })

const nameTaken = () => conflictField('name', 'Đã có loại cam kết cùng tên')

/**
 * Danh sách đóng các loại cam kết. Ai soạn sản phẩm hay xem chứng từ cũng đọc được;
 * thêm, sửa cần `commitment.edit`. Không có xóa: cam kết đã ghi luôn trỏ tới một loại còn tồn tại.
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
      const created = await audited(prisma, req, async (tx, audit) => {
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
      const updated = await audited(prisma, req, async (tx, audit) => {
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
