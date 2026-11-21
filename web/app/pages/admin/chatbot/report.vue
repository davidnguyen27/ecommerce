<script setup lang="ts">
import { ChatbotReport, ReportQuery } from '@ecommerce/shared'

// Báo cáo chatbot (spec M8). Trang riêng, không nằm trong trang Báo cáo của M7: trang đó đòi `report.view`, còn báo cáo
// này chỉ cần `chatbot.manage`. Kỳ đọc từ query string như các báo cáo khác, nên link chia sẻ được.
definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'chatbot.manage' })

const session = useAdminSession()
const route = useRoute()
const router = useRouter()
const period = useReportPeriod()
const form = reactive({ ...period.value })
const report = ref<ChatbotReport | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  try {
    report.value = ChatbotReport.parse(
      await session.adminFetch('/api/admin/reports/chatbot', { query: { ...period.value } }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function apply() {
  const parsed = ReportQuery.safeParse(form)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Kỳ báo cáo không hợp lệ'
    return
  }
  return router.replace({ query: { ...route.query, ...parsed.data } })
}

const number = (value: number) => value.toLocaleString('vi-VN')

watch(period, (value) => {
  Object.assign(form, value)
  void load()
})
await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Báo cáo chatbot</h1>
        <p class="admin-page-desc">
          Ngày theo giờ Việt Nam. Cuộc trò chuyện tính theo lúc mở cuộc, tin theo lúc gửi. Cuộc bị xóa sau 90 ngày (trừ
          cuộc đã chuyển nhân viên), nên kỳ cũ hơn thiếu số cuộc và số tin; số theo model vẫn đủ.
        </p>
      </div>
      <NuxtLink to="/admin/chatbot" class="btn btn-secondary btn-sm">Cài đặt chatbot</NuxtLink>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <form
        style="
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) 120px;
          gap: 12px;
          align-items: flex-end;
        "
        @submit.prevent="apply"
      >
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="chat-report-from" style="font-size: 12px">Từ ngày</label>
          <input id="chat-report-from" v-model="form.from" type="date" required class="form-input" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="chat-report-to" style="font-size: 12px">Đến ngày</label>
          <input id="chat-report-to" v-model="form.to" type="date" required class="form-input" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="chat-report-group" style="font-size: 12px">Nhóm theo</label>
          <select id="chat-report-group" v-model="form.groupBy" class="form-select">
            <option value="day">Ngày</option>
            <option value="month">Tháng</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Xem</button>
      </form>
      <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="margin: 12px 0 0">{{ error }}</div>
    </div>

    <template v-if="report">
      <div class="admin-table-card" style="margin-bottom: 20px">
        <table class="admin-table" data-testid="chatbot-report-total">
          <thead>
            <tr>
              <th class="admin-table-num">Cuộc trò chuyện</th>
              <th class="admin-table-num">Câu hỏi</th>
              <th class="admin-table-num">Đã chuyển nhân viên</th>
              <th class="admin-table-num">Tỷ lệ chuyển</th>
              <th class="admin-table-num">Hết lượt</th>
              <th class="admin-table-num">Lỗi</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="admin-table-num">{{ number(report.total.conversations) }}</td>
              <td class="admin-table-num">{{ number(report.total.customerMessages) }}</td>
              <td class="admin-table-num">{{ number(report.total.handedOff) }}</td>
              <td class="admin-table-num">{{ formatReportRate(report.total.handoffRate) }}</td>
              <td class="admin-table-num">{{ number(report.total.exhaustedTurns) }}</td>
              <td class="admin-table-num">{{ number(report.total.failedTurns) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="admin-table-card" style="margin-bottom: 20px">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ report.groupBy === 'day' ? 'Ngày' : 'Tháng' }}</th>
              <th class="admin-table-num">Cuộc trò chuyện</th>
              <th class="admin-table-num">Câu hỏi</th>
              <th class="admin-table-num">Đã chuyển</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.rows" :key="row.period">
              <td>{{ formatReportPeriod(row.period) }}</td>
              <td class="admin-table-num">{{ number(row.conversations) }}</td>
              <td class="admin-table-num">{{ number(row.customerMessages) }}</td>
              <td class="admin-table-num">{{ number(row.handedOff) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="admin-table-card">
        <div v-if="!report.models.length" style="padding: 24px; text-align: center; color: var(--adm-muted)">
          Chưa có lượt gọi model nào trong kỳ.
        </div>
        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>Model</th>
              <th class="admin-table-num">Lượt gọi</th>
              <th class="admin-table-num">Token vào</th>
              <th class="admin-table-num">Token ra</th>
              <th class="admin-table-num">Hết hạn mức (429)</th>
              <th class="admin-table-num">Lỗi khác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="model in report.models" :key="model.model">
              <td style="font-family: var(--adm-mono); font-size: 12px">{{ model.model }}</td>
              <td class="admin-table-num">{{ number(model.calls) }}</td>
              <td class="admin-table-num">{{ number(model.inputTokens) }}</td>
              <td class="admin-table-num">{{ number(model.outputTokens) }}</td>
              <td class="admin-table-num">{{ number(model.rateLimited) }}</td>
              <td class="admin-table-num">{{ number(model.errors) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
