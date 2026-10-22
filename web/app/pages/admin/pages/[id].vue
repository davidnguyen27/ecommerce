<script setup lang="ts">
import { ContentPageDetail, ContentPageVersion, ContentPageVersionList } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'content.edit' })

const route = useRoute()
const id = String(route.params.id)
const session = useAdminSession()

const page = ref<ContentPageDetail | null>(null)
const versions = ref<ContentPageVersionList['items']>([])
/** Phiên bản cũ đang mở để đọc lại. */
const viewing = ref<ContentPageVersion | null>(null)
const draft = reactive({ title: '', body: '' })
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const dirty = computed(() => !!page.value && (draft.title !== page.value.title || draft.body !== page.value.body))
const preview = computed(() => renderMarkdown(draft.body))
const viewingHtml = computed(() => (viewing.value ? renderMarkdown(viewing.value.body) : ''))

function show(detail: ContentPageDetail) {
  page.value = detail
  Object.assign(draft, { title: detail.title, body: detail.body })
}

async function load() {
  show(ContentPageDetail.parse(await session.adminFetch(`/api/admin/pages/${id}`)))
  versions.value = ContentPageVersionList.parse(await session.adminFetch(`/api/admin/pages/${id}/versions`)).items
}

/** Chạy một thao tác; xong thì hiện thông báo nó trả về, lỗi thì hiện thông báo từ API. */
async function runWithNotice(action: () => Promise<string | null>) {
  error.value = null
  notice.value = null
  try {
    notice.value = await action()
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function save() {
  return runWithNotice(async () => {
    show(ContentPageDetail.parse(await session.adminFetch(`/api/admin/pages/${id}`, { method: 'PUT', body: draft })))
    return 'Đã lưu bản nháp'
  })
}

// Xuất bản bản nháp đã lưu trên máy chủ, nên nút chỉ bấm được khi không còn thay đổi chưa lưu.
function publish() {
  return runWithNotice(async () => {
    const version = ContentPageVersion.parse(
      await session.adminFetch(`/api/admin/pages/${id}/publish`, { method: 'POST' }),
    )
    await load()
    return `Khách đang thấy phiên bản ${version.version}`
  })
}

function openVersion(version: number) {
  return runWithNotice(async () => {
    viewing.value = ContentPageVersion.parse(await session.adminFetch(`/api/admin/pages/${id}/versions/${version}`))
    return null
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('vi-VN')
}

await load()
</script>

<template>
  <main v-if="page">
    <p><NuxtLink to="/admin/pages">← Trang nội dung</NuxtLink></p>
    <h1>{{ page.title }}</h1>
    <p>
      {{ CONTENT_PAGE_KIND_LABELS[page.kind] }} · Slug: <code>{{ page.slug }}</code> ·
      <template v-if="page.status === 'draft'">Nháp, khách chưa thấy</template>
      <template v-else>
        Khách đang thấy phiên bản {{ page.currentVersion }} tại
        <a :href="`/trang/${page.slug}`" target="_blank" rel="noopener">/trang/{{ page.slug }}</a>
        <template v-if="page.hasUnpublishedChanges"> · Có thay đổi chưa xuất bản</template>
      </template>
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>

    <form @submit.prevent="save">
      <label>Tiêu đề <input v-model="draft.title" required /></label>
      <label>
        Nội dung (Markdown)
        <textarea v-model="draft.body" rows="20" cols="80" />
      </label>
      <button type="submit" :disabled="!dirty">Lưu nháp</button>
      <button type="button" :disabled="dirty" @click="publish">Xuất bản</button>
      <span v-if="dirty">Lưu nháp trước khi xuất bản</span>
    </form>

    <h2>Xem trước</h2>
    <!-- renderMarkdown đã thoát HTML trong nội dung -->
    <article v-html="preview" />

    <h2>Lịch sử phiên bản</h2>
    <p v-if="!versions.length">Chưa xuất bản lần nào.</p>
    <ol v-else>
      <li v-for="v in versions" :key="v.id">
        <button type="button" @click="openVersion(v.version)">Phiên bản {{ v.version }}</button>
        {{ v.title }} · {{ formatTime(v.publishedAt) }} · {{ v.publishedBy.name }}
      </li>
    </ol>

    <section v-if="viewing">
      <h3>Phiên bản {{ viewing.version }}: {{ viewing.title }}</h3>
      <button type="button" @click="viewing = null">Đóng</button>
      <!-- renderMarkdown đã thoát HTML trong nội dung -->
      <article v-html="viewingHtml" />
    </section>
  </main>
</template>
