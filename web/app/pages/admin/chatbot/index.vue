<script setup lang="ts">
import { ChatbotModelStatus, ChatbotSettings } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'chatbot.manage' })

// Chatbot settings (spec M8): on/off, the response-time sentence read to customers on handoff, model status.
const session = useAdminSession()
const form = reactive(ChatbotSettings.parse(await session.adminFetch('/api/admin/chatbot/settings')))
const models = ref<ChatbotModelStatus | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const isSaving = ref(false)

async function loadStatus() {
  try {
    models.value = ChatbotModelStatus.parse(await session.adminFetch('/api/admin/chatbot/status'))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

async function save() {
  error.value = null
  notice.value = null
  isSaving.value = true
  try {
    const saved = ChatbotSettings.parse(
      await session.adminFetch('/api/admin/chatbot/settings', { method: 'PUT', body: { ...form } }),
    )
    Object.assign(form, saved)
    notice.value = saved.enabled ? 'Đã lưu. Chatbot đang bật.' : 'Đã lưu. Chatbot đang tắt; khách vẫn gửi được yêu cầu.'
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    isSaving.value = false
  }
}

await loadStatus()
</script>

<template>
  <main>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Chatbot</h1>
        <p class="admin-page-desc">
          Trợ lý tư vấn trên website khách: tìm sản phẩm, đọc bảng size và chính sách, chuyển khách cho nhân viên.
        </p>
      </div>
      <div class="admin-topbar-actions">
        <NuxtLink to="/admin/chatbot/conversations" class="btn btn-secondary">Cuộc trò chuyện</NuxtLink>
        <NuxtLink to="/admin/chatbot/report" class="btn btn-secondary">Báo cáo</NuxtLink>
        <button type="submit" form="chatbot-form" class="btn btn-primary" :disabled="isSaving">
          {{ isSaving ? 'Đang lưu...' : 'Lưu thay đổi' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">{{ error }}</div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">{{ notice }}</div>

    <div class="admin-two-col">
      <form id="chatbot-form" class="admin-panel" @submit.prevent="save">
        <h2 class="admin-section-title">Cài đặt</h2>
        <label class="form-group" style="display: flex; gap: 8px; align-items: center">
          <input v-model="form.enabled" type="checkbox" data-testid="chatbot-enabled" />
          <span>Bật chatbot trên website</span>
        </label>
        <div class="form-group">
          <label class="form-label" for="chatbot-note">Câu thời gian phản hồi</label>
          <textarea
            id="chatbot-note"
            v-model="form.responseTimeNote"
            class="form-textarea"
            rows="3"
            maxlength="300"
            placeholder="Ví dụ: Nhân viên trả lời trong giờ hành chính, thứ 2 đến thứ 7."
          />
          <p class="form-help">Hiện cho khách ngay sau khi khách gửi yêu cầu cho nhân viên. Để trống thì không hiện.</p>
        </div>
      </form>

      <section class="admin-panel">
        <div class="admin-panel-header">
          <h2 class="admin-section-title">Model</h2>
          <button type="button" class="btn btn-ghost btn-sm" @click="loadStatus">Làm mới</button>
        </div>
        <p v-if="models && !models.configured" class="form-help" data-testid="chatbot-unconfigured">
          Máy chủ chưa đặt khóa model nào (GROQ_API_KEY, OPENROUTER_API_KEY): chatbot không trả lời được dù đang bật.
        </p>
        <table v-else-if="models" class="admin-table">
          <thead>
            <tr>
              <th>Model (theo thứ tự dùng)</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="model in models.models" :key="model.model">
              <td style="font-family: var(--adm-mono); font-size: 12px">{{ model.model }}</td>
              <td style="font-size: 12px">
                {{ model.exhaustedUntil ? `Hết lượt tới ${formatDateTime(model.exhaustedUntil)}` : 'Dùng được' }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="form-help">
          Gói miễn phí: mỗi model khoảng 200.000 token mỗi ngày. Hết lượt thì chatbot chuyển sang model sau; hết cả
          chuỗi thì khách thấy "hết lượt" kèm nút gửi cho nhân viên.
        </p>
      </section>
    </div>
  </main>
</template>
