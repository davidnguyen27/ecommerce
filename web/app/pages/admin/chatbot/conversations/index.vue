<script setup lang="ts">
import { AdminChatConversationPage } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'chatbot.manage' })

const PAGE_SIZE = 50

const session = useAdminSession()
const canOpenSupport = computed(() => session.canOpen('/admin/support'))
const result = ref<AdminChatConversationPage | null>(null)
const error = ref<string | null>(null)
const filters = reactive({ from: '', to: '', handedOff: 'all' as 'all' | 'true' | 'false', failed: false })
const page = ref(1)

async function load() {
  error.value = null
  try {
    result.value = AdminChatConversationPage.parse(
      await session.adminFetch('/api/admin/chatbot/conversations', {
        query: {
          from: filters.from || undefined,
          to: filters.to || undefined,
          handedOff: filters.handedOff === 'all' ? undefined : filters.handedOff,
          failed: filters.failed ? 'true' : undefined,
          page: page.value,
          pageSize: PAGE_SIZE,
        },
      }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function filter() {
  page.value = 1
  return load()
}

function goTo(target: number) {
  page.value = target
  return load()
}

const lastPage = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / PAGE_SIZE)))

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Cuộc trò chuyện với chatbot</h1>
        <p class="admin-page-desc">
          Lưu 90 ngày từ tin cuối; cuộc đã chuyển nhân viên được giữ cùng yêu cầu. Mới nhất ở trên cùng.
        </p>
      </div>
      <NuxtLink to="/admin/chatbot" class="btn btn-secondary btn-sm">Cài đặt chatbot</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">{{ error }}</div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: end">
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="chat-from" style="font-size: 12px">Từ ngày</label>
          <input id="chat-from" v-model="filters.from" type="date" class="form-input" @change="filter" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="chat-to" style="font-size: 12px">Đến ngày</label>
          <input id="chat-to" v-model="filters.to" type="date" class="form-input" @change="filter" />
        </div>
        <div class="form-group" style="margin-bottom: 0; min-width: 180px">
          <label class="form-label" for="chat-handed-off" style="font-size: 12px">Chuyển nhân viên</label>
          <select id="chat-handed-off" v-model="filters.handedOff" class="form-select" @change="filter">
            <option value="all">Tất cả</option>
            <option value="true">Đã chuyển</option>
            <option value="false">Chưa chuyển</option>
          </select>
        </div>
        <label style="display: flex; gap: 6px; align-items: center; font-size: 13px">
          <input v-model="filters.failed" type="checkbox" @change="filter" />
          Có lượt không trả lời được
        </label>
      </div>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Không có cuộc trò chuyện nào.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Câu hỏi đầu</th>
                <th class="admin-table-num">Số câu</th>
                <th class="admin-table-num">Không trả lời được</th>
                <th>Yêu cầu</th>
                <th>Tin cuối</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in result.items" :key="item.id" data-testid="chat-conversation-row">
                <td>
                  <NuxtLink :to="`/admin/chatbot/conversations/${item.id}`">{{ item.firstQuestion || '—' }}</NuxtLink>
                </td>
                <td class="admin-table-num">{{ item.customerMessageCount }}</td>
                <td class="admin-table-num">{{ item.failedTurns || '' }}</td>
                <td>
                  <!-- chatbot.manage alone may not open support requests: show just the code. -->
                  <NuxtLink
                    v-if="item.supportRequestCode && canOpenSupport"
                    :to="`/admin/support/${item.supportRequestCode}`"
                    >#YC{{ item.supportRequestCode }}</NuxtLink
                  >
                  <span v-else-if="item.supportRequestCode">#YC{{ item.supportRequestCode }}</span>
                  <span v-else style="color: var(--adm-muted)">—</span>
                </td>
                <td style="white-space: nowrap; font-size: 12px">{{ formatDateTime(item.lastMessageAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-top: 1px solid var(--adm-border);
          "
        >
          <div style="font-size: 12px; color: var(--adm-muted)">
            Trang <strong>{{ page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} cuộc)
          </div>
          <div style="display: flex; gap: 8px">
            <button type="button" class="btn btn-secondary btn-sm" :disabled="page <= 1" @click="goTo(page - 1)">
              ‹ Trang trước
            </button>
            <button type="button" class="btn btn-secondary btn-sm" :disabled="page >= lastPage" @click="goTo(page + 1)">
              Trang sau ›
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
