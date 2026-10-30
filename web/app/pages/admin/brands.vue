<script setup lang="ts">
import { AdminBrandList, type AdminBrand } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'catalog.edit' })

const session = useAdminSession()
const brands = ref<AdminBrand[]>([])
const error = ref<string | null>(null)
const showCreatePanel = ref(false)
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

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

watch(
  () => form.name,
  (name) => {
    if (!form.slug || form.slug === slugify(name.slice(0, -1))) {
      form.slug = slugify(name)
    }
  },
)

async function create() {
  const ok = await run(() => session.adminFetch('/api/admin/brands', { method: 'POST', body: form }))
  if (ok) {
    Object.assign(form, { name: '', slug: '', description: '' })
    showCreatePanel.value = false
  }
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
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Thương hiệu</h1>
        <p class="admin-page-desc">
          Quản lý các nhãn hàng & nhà mốt thời trang quốc tế. Ẩn thương hiệu sẽ tạm gỡ trang riêng và menu của hãng; các
          sản phẩm đã xuất bản của hãng vẫn hiển thị bình thường.
        </p>
      </div>

      <div class="admin-topbar-actions">
        <button type="button" class="btn btn-primary" @click="showCreatePanel = !showCreatePanel">
          <span>{{ showCreatePanel ? 'Đóng form' : '+ Thêm thương hiệu mới' }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="showCreatePanel" class="admin-panel" style="border-left: 3px solid var(--adm-dark)">
      <div class="admin-panel-header">
        <div>
          <h2 class="admin-section-title" style="margin: 0">Thêm thương hiệu mới</h2>
          <p class="form-help" style="margin-top: 2px">Logo và ảnh đại diện có thể tải lên sau khi tạo.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="showCreatePanel = false">✕ Đóng</button>
      </div>

      <form @submit.prevent="create">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="brands-form-name">Tên thương hiệu *</label>
            <input
              id="brands-form-name"
              v-model="form.name"
              class="form-input"
              placeholder="Ví dụ: Gucci, Seiko, Creed..."
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="brands-form-slug">Slug URL *</label>
            <input
              id="brands-form-slug"
              v-model="form.slug"
              class="form-input"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="gucci"
              required
            />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="brands-form-description">Mô tả giới thiệu thương hiệu</label>
          <textarea
            id="brands-form-description"
            v-model="form.description"
            class="form-textarea"
            rows="3"
            placeholder="Lịch sử thương hiệu, quốc gia xuất xứ..."
          />
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <button type="button" class="btn btn-secondary" @click="showCreatePanel = false">Hủy</button>
          <button type="submit" class="btn btn-primary">Tạo thương hiệu ›</button>
        </div>
      </form>
    </div>

    <div class="admin-table-card">
      <table class="admin-table">
        <thead>
          <tr>
            <th style="width: 80px">Logo</th>
            <th>Tên thương hiệu</th>
            <th>Slug URL</th>
            <th>Mô tả</th>
            <th>Trạng thái</th>
            <th style="text-align: right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="brand in brands" :key="brand.id">
            <template v-if="editing?.id === brand.id">
              <td>
                <img
                  v-if="brand.logo"
                  :src="brand.logo.sizes[0]?.url"
                  :alt="`Logo ${brand.name}`"
                  style="height: 32px; max-width: 60px; object-fit: contain"
                />
                <div
                  v-else
                  style="width: 32px; height: 32px; background: var(--adm-surface-subtle); border-radius: 4px"
                />
              </td>
              <td><input v-model="editing.name" class="form-input" required /></td>
              <td><input v-model="editing.slug" class="form-input" required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></td>
              <td><textarea v-model="editing.description" class="form-textarea" rows="2" /></td>
              <td>
                <span class="badge" :class="brand.hidden ? 'badge-draft' : 'badge-published'">
                  {{ brand.hidden ? 'Đang ẩn' : 'Hiển thị' }}
                </span>
              </td>
              <td style="text-align: right">
                <div style="display: flex; justify-content: flex-end; gap: 6px">
                  <button type="button" class="btn btn-primary btn-sm" @click="save">Lưu</button>
                  <button type="button" class="btn btn-secondary btn-sm" @click="editing = null">Hủy</button>
                </div>
              </td>
            </template>

            <template v-else>
              <td>
                <img
                  v-if="brand.logo"
                  :src="brand.logo.sizes[0]?.url"
                  :alt="`Logo ${brand.name}`"
                  style="height: 32px; max-width: 60px; object-fit: contain; border-radius: 4px"
                />
                <div
                  v-else
                  style="
                    width: 32px;
                    height: 32px;
                    background: var(--adm-surface-subtle);
                    color: var(--adm-muted);
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 11px;
                    font-weight: 700;
                  "
                >
                  {{ brand.name.slice(0, 1).toUpperCase() }}
                </div>
              </td>
              <td>
                <span style="font-weight: 600; font-size: 14px">{{ brand.name }}</span>
              </td>
              <td>
                <code style="font-family: var(--adm-mono); font-size: 12px; color: var(--adm-muted)">
                  /thuong-hieu/{{ brand.slug }}
                </code>
              </td>
              <td
                style="
                  color: var(--adm-muted);
                  max-width: 320px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                "
              >
                {{ brand.description || '—' }}
              </td>
              <td>
                <span class="badge" :class="brand.hidden ? 'badge-draft' : 'badge-published'">
                  <span class="badge-dot" />
                  {{ brand.hidden ? 'Đang ẩn' : 'Hiển thị' }}
                </span>
              </td>
              <td style="text-align: right">
                <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px">
                  <template v-if="canUpload">
                    <label class="btn btn-ghost btn-sm" style="cursor: pointer; padding: 4px 8px">
                      <span>{{ brand.logo ? 'Đổi logo' : '+ Logo' }}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style="display: none"
                        @change="uploadLogo(brand.id, $event)"
                      />
                    </label>
                    <button
                      v-if="brand.logo"
                      type="button"
                      class="btn btn-ghost btn-sm"
                      style="color: var(--adm-danger); padding: 4px 6px"
                      title="Gỡ logo"
                      @click="removeLogo(brand.id)"
                    >
                      ✕
                    </button>
                  </template>

                  <button type="button" class="btn btn-secondary btn-sm" @click="setHidden(brand.id, !brand.hidden)">
                    {{ brand.hidden ? 'Bỏ ẩn' : 'Ẩn' }}
                  </button>

                  <button type="button" class="btn btn-secondary btn-sm" @click="edit(brand)">Sửa</button>
                </div>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
