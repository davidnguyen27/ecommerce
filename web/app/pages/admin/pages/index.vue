<script setup lang="ts">
import { ContentPageDetail, ContentPageKind, ContentPageList, PRIVACY_POLICY_SLUG } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'content.edit' })

type Page = ContentPageList['items'][number]

const session = useAdminSession()
const list = ref<Page[]>([])
const error = ref<string | null>(null)
const form = reactive({ slug: '', kind: 'policy' as ContentPageKind, title: '' })

const hasPrivacyPolicy = computed(() => list.value.some((page) => page.slug === PRIVACY_POLICY_SLUG))

async function create() {
  error.value = null
  try {
    const page = ContentPageDetail.parse(
      await session.adminFetch('/api/admin/pages', { method: 'POST', body: { ...form, body: '' } }),
    )
    await navigateTo(`/admin/pages/${page.id}`)
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function status(page: Page) {
  if (page.status === 'draft') return 'Nháp'
  const published = `Đã xuất bản (v${page.currentVersion})`
  return page.hasUnpublishedChanges ? `${published}, có thay đổi chưa xuất bản` : published
}

list.value = ContentPageList.parse(await session.adminFetch('/api/admin/pages')).items
</script>

<template>
  <main>
    <h1>Trang nội dung</h1>
    <p v-if="!hasPrivacyPolicy">
      Chưa có trang chính sách bảo mật. Khách đăng ký sẽ đồng ý với trang có slug
      <code>{{ PRIVACY_POLICY_SLUG }}</code>.
    </p>

    <table>
      <thead>
        <tr>
          <th>Tiêu đề</th>
          <th>Slug</th>
          <th>Loại</th>
          <th>Trạng thái</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="page in list" :key="page.id">
          <td>
            <NuxtLink :to="`/admin/pages/${page.id}`">{{ page.title }}</NuxtLink>
          </td>
          <td>{{ page.slug }}</td>
          <td>{{ CONTENT_PAGE_KIND_LABELS[page.kind] }}</td>
          <td>{{ status(page) }}</td>
        </tr>
      </tbody>
    </table>

    <h2>Tạo trang</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <form @submit.prevent="create">
      <label>Tiêu đề <input v-model="form.title" required /></label>
      <label>
        Slug (không đổi được sau khi tạo)
        <input v-model="form.slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="chinh-sach-doi-tra" />
      </label>
      <label>
        Loại (không đổi được sau khi tạo)
        <select v-model="form.kind">
          <option v-for="kind in ContentPageKind.options" :key="kind" :value="kind">
            {{ CONTENT_PAGE_KIND_LABELS[kind] }}
          </option>
        </select>
      </label>
      <button type="submit">Tạo và soạn</button>
    </form>
  </main>
</template>
