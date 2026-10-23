<script setup lang="ts">
import { AdminBrandList, type AdminBrand } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'catalog.edit' })

const session = useAdminSession()
const brands = ref<AdminBrand[]>([])
const error = ref<string | null>(null)
const form = reactive({ name: '', slug: '', description: '' })
/** Thương hiệu đang sửa, trước khi bấm lưu. */
const editing = ref<(typeof form & { id: string }) | null>(null)

async function load() {
  brands.value = AdminBrandList.parse(await session.adminFetch('/api/admin/brands')).items
}

/** Chạy một thao tác rồi tải lại danh sách; lỗi thì hiện thông báo từ API. */
async function run(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
    await load()
    return true
  } catch (err) {
    error.value = apiErrorMessage(err)
    return false
  }
}

async function create() {
  const ok = await run(() => session.adminFetch('/api/admin/brands', { method: 'POST', body: form }))
  if (ok) Object.assign(form, { name: '', slug: '', description: '' })
}

function edit({ id, name, slug, description }: AdminBrand) {
  editing.value = { id, name, slug, description }
}

async function save() {
  const { id, ...body } = editing.value!
  if (await run(() => session.adminFetch(`/api/admin/brands/${id}`, { method: 'PUT', body }))) editing.value = null
}

function setHidden(id: string, hidden: boolean) {
  return run(() => session.adminFetch(`/api/admin/brands/${id}/${hidden ? 'hide' : 'unhide'}`, { method: 'POST' }))
}

const canUpload = session.can('media.upload')

async function uploadLogo(id: string, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const body = new FormData()
  body.append('file', file)
  await run(() => session.adminFetch(`/api/admin/brands/${id}/logo`, { method: 'PUT', body }))
  input.value = ''
}

function removeLogo(id: string) {
  return run(() => session.adminFetch(`/api/admin/brands/${id}/logo`, { method: 'DELETE' }))
}

await load()
</script>

<template>
  <main>
    <h1>Thương hiệu</h1>
    <p>Ẩn thương hiệu chỉ gỡ nó khỏi danh sách và trang thương hiệu trên website; sản phẩm của nó vẫn hiện.</p>
    <p v-if="error" role="alert">{{ error }}</p>

    <table>
      <thead>
        <tr>
          <th>Tên</th>
          <th>Slug</th>
          <th>Mô tả</th>
          <th>Trạng thái</th>
          <th>Logo</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="brand in brands" :key="brand.id">
          <template v-if="editing?.id === brand.id">
            <td><input v-model="editing.name" aria-label="Tên" required /></td>
            <td><input v-model="editing.slug" aria-label="Slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></td>
            <td><textarea v-model="editing.description" aria-label="Mô tả" /></td>
            <td>{{ brand.hidden ? 'Đang ẩn' : 'Đang hiển thị' }}</td>
            <td />
            <td>
              <button type="button" @click="save">Lưu</button>
              <button type="button" @click="editing = null">Hủy</button>
            </td>
          </template>
          <template v-else>
            <td>{{ brand.name }}</td>
            <td>{{ brand.slug }}</td>
            <td>{{ brand.description }}</td>
            <td>
              {{ brand.hidden ? 'Đang ẩn' : 'Đang hiển thị' }}
              <button type="button" @click="setHidden(brand.id, !brand.hidden)">
                {{ brand.hidden ? 'Bỏ ẩn' : 'Ẩn' }}
              </button>
            </td>
            <td>
              <img v-if="brand.logo" :src="brand.logo.sizes[0]?.url" :alt="`Logo ${brand.name}`" height="40" />
              <template v-if="canUpload">
                <label>
                  {{ brand.logo ? 'Đổi logo' : 'Tải logo' }}
                  <input type="file" accept="image/jpeg,image/png,image/webp" @change="uploadLogo(brand.id, $event)" />
                </label>
                <button v-if="brand.logo" type="button" @click="removeLogo(brand.id)">Gỡ logo</button>
              </template>
            </td>
            <td><button type="button" @click="edit(brand)">Sửa</button></td>
          </template>
        </tr>
      </tbody>
    </table>

    <h2>Thêm thương hiệu</h2>
    <form @submit.prevent="create">
      <label>Tên <input v-model="form.name" required /></label>
      <label>
        Slug
        <input v-model="form.slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="seiko" />
      </label>
      <label>Mô tả <textarea v-model="form.description" /></label>
      <button type="submit">Tạo thương hiệu</button>
    </form>
  </main>
</template>
