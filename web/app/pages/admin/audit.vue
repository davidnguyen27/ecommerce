<script setup lang="ts">
import { AuditActors, AuditPage, type AuditActor } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'audit.view' })

const PAGE_SIZE = 50
const ENTITY_TYPES = AUDIT_ENTITY_TYPES

const session = useAdminSession()
const actors = ref<AuditActor[]>([])
const result = ref<AuditPage | null>(null)
const error = ref<string | null>(null)
// Ngày lấy từ ô chọn ngày, hiểu theo giờ của trình duyệt; `to` tính hết ngày đã chọn.
const filters = reactive({ actorId: '', entityType: '', from: '', to: '', page: 1 })

function startOfDay(date: string, addDays = 0) {
  const day = new Date(`${date}T00:00:00`)
  day.setDate(day.getDate() + addDays)
  return day.toISOString()
}

async function load() {
  error.value = null
  const query = {
    actorId: filters.actorId || undefined,
    entityType: filters.entityType || undefined,
    from: filters.from ? startOfDay(filters.from) : undefined,
    to: filters.to ? startOfDay(filters.to, 1) : undefined,
    page: filters.page,
    pageSize: PAGE_SIZE,
  }
  try {
    result.value = AuditPage.parse(await session.adminFetch('/api/admin/audit', { query }))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function search() {
  filters.page = 1
  return load()
}

function resetFilters() {
  filters.actorId = ''
  filters.entityType = ''
  filters.from = ''
  filters.to = ''
  filters.page = 1
  return load()
}

function goTo(page: number) {
  filters.page = page
  return load()
}

const lastPage = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / PAGE_SIZE)))

const formatJson = (val: unknown) => {
  if (val === null || val === undefined) return '—'
  return JSON.stringify(val, null, 2)
}

actors.value = AuditActors.parse(await session.adminFetch('/api/admin/audit/actors')).items
await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Nhật ký kiểm toán (Audit Log)</h1>
        <p class="admin-page-desc">
          Bản ghi append-only ghi nhận mọi thay đổi nhạy cảm (giá bán, phân quyền, vòng đời sản phẩm, xem chứng từ).
          Bảng được bảo vệ bằng trigger cơ sở dữ liệu, không thể sửa hay xóa.
        </p>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <form @submit.prevent="search">
        <div
          style="
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) 160px;
            gap: 12px;
            align-items: flex-end;
          "
        >
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="audit-filters-actor-id" style="font-size: 12px">Người thực hiện</label>
            <select
              id="audit-filters-actor-id"
              v-model="filters.actorId"
              class="form-select"
              style="font-size: 12px; padding: 6px 10px"
            >
              <option value="">-- Tất cả nhân sự --</option>
              <option v-for="actor in actors" :key="actor.id" :value="actor.id">
                {{ actor.name }} ({{ actor.email }})
              </option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="audit-filters-entity-type" style="font-size: 12px">Loại đối tượng</label>
            <select
              id="audit-filters-entity-type"
              v-model="filters.entityType"
              class="form-select"
              style="font-size: 12px; padding: 6px 10px"
            >
              <option value="">-- Tất cả đối tượng --</option>
              <option v-for="t in ENTITY_TYPES" :key="t" :value="t">{{ auditEntityLabel(t) }}</option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="audit-filters-from" style="font-size: 12px">Từ ngày</label>
            <input
              id="audit-filters-from"
              v-model="filters.from"
              type="date"
              class="form-input"
              style="font-size: 12px; padding: 5px 10px"
            />
          </div>

          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="audit-filters-to" style="font-size: 12px">Đến ngày</label>
            <input
              id="audit-filters-to"
              v-model="filters.to"
              type="date"
              class="form-input"
              style="font-size: 12px; padding: 5px 10px"
            />
          </div>

          <div style="display: flex; gap: 6px">
            <button type="submit" class="btn btn-primary btn-sm" style="flex: 1">Lọc kết quả</button>
            <button type="button" class="btn btn-secondary btn-sm" @click="resetFilters">Đặt lại</button>
          </div>
        </div>
      </form>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Không có bản ghi kiểm toán nào phù hợp với điều kiện tìm kiếm.
      </div>

      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th style="min-width: 140px">Thời điểm</th>
                <th>Người thực hiện</th>
                <th>Hành động</th>
                <th>Đối tượng</th>
                <th style="min-width: 180px">Trước (Before)</th>
                <th style="min-width: 180px">Sau (After)</th>
                <th style="min-width: 130px">IP & Thiết bị</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in result.items" :key="entry.id">
                <td style="font-family: var(--adm-mono); font-size: 11px; color: var(--adm-muted); white-space: nowrap">
                  {{ formatDateTime(entry.createdAt, { seconds: true }) }}
                </td>
                <td>
                  <strong style="color: var(--adm-ink)">{{ entry.actor.name }}</strong>
                </td>
                <td>
                  <div style="font-weight: 500; color: var(--adm-ink)">{{ auditActionLabel(entry.action) }}</div>
                  <code style="font-family: var(--adm-mono); font-size: 10px; color: var(--adm-muted)">
                    {{ entry.action }}
                  </code>
                </td>
                <td>
                  <span style="font-weight: 500; white-space: nowrap">{{ auditEntityLabel(entry.entityType) }}</span>
                  <div style="font-family: var(--adm-mono); font-size: 10px; color: var(--adm-muted)">
                    {{ entry.entityId.slice(0, 8) }}...
                  </div>
                </td>
                <td>
                  <pre
                    v-if="entry.before"
                    style="
                      font-family: var(--adm-mono);
                      font-size: 11px;
                      background: var(--adm-surface-subtle);
                      border-radius: 4px;
                      padding: 6px;
                      margin: 0;
                      max-height: 90px;
                      overflow-y: auto;
                      color: #4b5563;
                    "
                    >{{ formatJson(entry.before) }}</pre>
                  <span v-else style="color: var(--adm-muted); font-size: 12px">—</span>
                </td>
                <td>
                  <pre
                    v-if="entry.after"
                    style="
                      font-family: var(--adm-mono);
                      font-size: 11px;
                      background: var(--adm-surface-subtle);
                      border-radius: 4px;
                      padding: 6px;
                      margin: 0;
                      max-height: 90px;
                      overflow-y: auto;
                      color: #111827;
                    "
                    >{{ formatJson(entry.after) }}</pre>
                  <span v-else style="color: var(--adm-muted); font-size: 12px">—</span>
                </td>
                <td style="font-size: 11px; color: var(--adm-muted)">
                  <div style="font-family: var(--adm-mono)">{{ entry.ip || 'Localhost' }}</div>
                  <div
                    style="max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
                    :title="entry.userAgent ?? ''"
                  >
                    {{ entry.userAgent || '—' }}
                  </div>
                </td>
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
            background: var(--adm-surface);
          "
        >
          <div style="font-size: 12px; color: var(--adm-muted)">
            Hiển thị trang <strong>{{ filters.page }}</strong> trên <strong>{{ lastPage }}</strong> (Tổng cộng
            <strong>{{ result.total }}</strong> bản ghi kiểm toán)
          </div>

          <div style="display: flex; gap: 8px">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="filters.page <= 1"
              @click="goTo(filters.page - 1)"
            >
              ‹ Trang trước
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="filters.page >= lastPage"
              @click="goTo(filters.page + 1)"
            >
              Trang sau ›
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
