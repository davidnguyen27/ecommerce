<script setup lang="ts">
import { AdminChatConversation } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'chatbot.manage' })

// Một cuộc trò chuyện như khách thấy, kèm model đã trả lời, phiên bản prompt và lỗi của từng lượt (spec M8).
const session = useAdminSession()
const route = useRoute()
const conversation = ref<AdminChatConversation | null>(null)
const error = ref<string | null>(null)

try {
  conversation.value = AdminChatConversation.parse(
    await session.adminFetch(`/api/admin/chatbot/conversations/${String(route.params.id)}`),
  )
} catch (err) {
  error.value = apiErrorMessage(err)
}

const ERROR_LABELS: Record<string, string> = { exhausted: 'hết lượt', failed: 'lỗi model' }
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Cuộc trò chuyện</h1>
        <p v-if="conversation" class="admin-page-desc">
          Bắt đầu {{ formatDateTime(conversation.createdAt) }} · tin cuối
          {{ formatDateTime(conversation.lastMessageAt) }}
          <template v-if="conversation.supportRequestCode">
            · đã chuyển thành
            <NuxtLink :to="`/admin/support/${conversation.supportRequestCode}`"
              >#YC{{ conversation.supportRequestCode }}</NuxtLink
            >
          </template>
        </p>
      </div>
      <NuxtLink to="/admin/chatbot/conversations" class="btn btn-secondary btn-sm">‹ Danh sách</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">{{ error }}</div>

    <div v-if="conversation" class="admin-panel">
      <div
        v-for="m in conversation.messages"
        :key="m.id"
        data-testid="chat-admin-message"
        style="border-top: 1px solid var(--adm-border); padding: 12px 0"
      >
        <div style="font-size: 12px; color: var(--adm-muted); margin-bottom: 4px">
          {{ m.role === 'customer' ? 'Khách' : 'Chatbot' }} · {{ formatDateTime(m.createdAt) }}
          <template v-if="m.model"> · {{ m.model }} · prompt v{{ m.promptVersion }}</template>
          <strong v-if="m.error" style="color: #b91c1c">
            · không có trả lời ({{ ERROR_LABELS[m.error] ?? m.error }})</strong
          >
        </div>
        <div style="white-space: pre-line; font-size: 13px">{{ m.content }}</div>
        <div v-if="m.products.length" style="font-size: 12px; margin-top: 4px">
          Đã gợi ý:
          <template v-for="(p, i) in m.products" :key="p.slug"
            >{{ i ? ', ' : ''
            }}<a :href="`/san-pham/${p.slug}`" target="_blank" rel="noopener">{{ p.name }}</a></template
          >
        </div>
        <div v-if="m.handoffSummary" style="font-size: 12px; color: var(--adm-muted); margin-top: 4px">
          Đề nghị chuyển nhân viên: {{ m.handoffSummary }}
        </div>
      </div>
    </div>
  </div>
</template>
