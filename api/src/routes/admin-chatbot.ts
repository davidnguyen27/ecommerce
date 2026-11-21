import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import { ChatbotSettings } from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import { readChatbotSettings } from '../chat/chat.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'

/** Cài đặt chatbot (spec M8): quyền mới `chatbot.manage`, mặc định chỉ owner. */
export function adminChatbotRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('chatbot.manage'))
    .get('/settings', async (_req, res) => {
      const body: ChatbotSettings = await readChatbotSettings(prisma)
      res.json(body)
    })
    .put('/settings', async (req, res) => {
      const after = parse(ChatbotSettings, req.body)
      const body: ChatbotSettings = await audited(prisma, req, async (tx, audit) => {
        // Hai lần sửa cùng lúc thì `before` của lần sau là đúng bản lần trước đã ghi.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chatbot_setting'))`
        const before = await readChatbotSettings(tx)
        if (isDeepStrictEqual(before, after)) return before
        await tx.chatbotSetting.upsert({ where: { id: true }, create: after, update: after })
        await audit({ action: 'chatbot.settings.update', entityType: 'chatbot', entityId: 'chatbot', before, after })
        return after
      })
      res.json(body)
    })
}
