<script setup lang="ts">
import { AuditActors, AuditPage, type AuditActor } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'audit.view' })

const PAGE_SIZE = 50
const ENTITY_TYPES = ['staff', 'content_page', 'system_config']

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

function goTo(page: number) {
  filters.page = page
  return load()
}

const lastPage = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / PAGE_SIZE)))

actors.value = AuditActors.parse(await session.adminFetch('/api/admin/audit/actors')).items
await load()
</script>

<template>
  <main>
    <h1>Audit log</h1>

    <form @submit.prevent="search">
      <label>
        Người thực hiện
        <select v-model="filters.actorId">
          <option value="">Tất cả</option>
          <option v-for="actor in actors" :key="actor.id" :value="actor.id">{{ actor.name }} ({{ actor.email }})</option>
        </select>
      </label>
      <label>
        Loại đối tượng
        <select v-model="filters.entityType">
          <option value="">Tất cả</option>
          <option v-for="type in ENTITY_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label>Từ ngày <input v-model="filters.from" type="date" /></label>
      <label>Đến ngày <input v-model="filters.to" type="date" /></label>
      <button type="submit">Lọc</button>
    </form>

    <p v-if="error" role="alert">{{ error }}</p>

    <table v-if="result">
      <thead>
        <tr>
          <th>Thời điểm</th>
          <th>Người thực hiện</th>
          <th>Hành động</th>
          <th>Đối tượng</th>
          <th>Trước</th>
          <th>Sau</th>
          <th>IP / thiết bị</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in result.items" :key="entry.id">
          <td>{{ new Date(entry.createdAt).toLocaleString('vi-VN') }}</td>
          <td>{{ entry.actor.name }}</td>
          <td>{{ entry.action }}</td>
          <td>{{ entry.entityType }} {{ entry.entityId }}</td>
          <td><pre>{{ entry.before ?? '' }}</pre></td>
          <td><pre>{{ entry.after ?? '' }}</pre></td>
          <td>{{ entry.ip }}<br />{{ entry.userAgent }}</td>
        </tr>
      </tbody>
    </table>

    <nav v-if="result">
      <button type="button" :disabled="filters.page <= 1" @click="goTo(filters.page - 1)">Trang trước</button>
      Trang {{ filters.page }} / {{ lastPage }} ({{ result.total }} bản ghi)
      <button type="button" :disabled="filters.page >= lastPage" @click="goTo(filters.page + 1)">Trang sau</button>
    </nav>
  </main>
</template>
