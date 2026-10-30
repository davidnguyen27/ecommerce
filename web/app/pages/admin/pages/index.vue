<script setup lang="ts">
import { ContentPageDetail, ContentPageKind, ContentPageList, PRIVACY_POLICY_SLUG } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'content.edit' })

type Page = ContentPageList['items'][number]

const session = useAdminSession()
const list = ref<Page[]>([])
const error = ref<string | null>(null)
const showCreatePanel = ref(false)
const selectedFilter = ref<string>('all')

const form = reactive({ slug: '', kind: 'policy' as ContentPageKind, title: '' })

const hasPrivacyPolicy = computed(() => list.value.some((page) => page.slug === PRIVACY_POLICY_SLUG))

const filteredList = computed(() => {
  if (selectedFilter.value === 'all') return list.value
  return list.value.filter((p) => p.kind === selectedFilter.value)
})

function quickFillPrivacy() {
  form.title = 'Chính sách bảo mật thông tin cá nhân'
  form.slug = PRIVACY_POLICY_SLUG
  form.kind = 'policy'
  showCreatePanel.value = true
}

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

list.value = ContentPageList.parse(await session.adminFetch('/api/admin/pages')).items
</script>

<template>
  <main>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Trang nội dung & Chính sách</h1>
        <p class="admin-page-desc">
          Quản lý nội dung tĩnh, quy trình mua sắm, cam kết chất lượng và các chính sách bảo vệ người tiêu dùng theo quy
          định thương mại điện tử.
        </p>
      </div>
      <div class="admin-topbar-actions">
        <button class="btn btn-primary" @click="showCreatePanel = !showCreatePanel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          {{ showCreatePanel ? 'Đóng tạo trang' : 'Tạo trang mới' }}
        </button>
      </div>
    </div>

    <div v-if="!hasPrivacyPolicy" class="admin-alert admin-alert-warn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <div style="flex: 1">
        <strong>Thiếu trang bắt buộc:</strong> Chưa có trang Chính sách bảo mật thông tin với slug chuẩn
        <code>{{ PRIVACY_POLICY_SLUG }}</code> theo quy định của Bộ Công Thương.
      </div>
      <button class="btn btn-secondary btn-sm" @click="quickFillPrivacy">Tạo nhanh chính sách bảo mật</button>
    </div>

    <div v-if="showCreatePanel" class="admin-panel" style="margin-bottom: 24px">
      <div class="admin-panel-header">
        <div>
          <h2 class="admin-section-title" style="margin-bottom: 2px">Khởi tạo trang nội dung mới</h2>
          <span class="form-help">Slug và phân loại sẽ được cố định sau khi khởi tạo để bảo toàn đường dẫn SEO.</span>
        </div>
        <button class="btn btn-ghost btn-sm" @click="showCreatePanel = false">Đóng</button>
      </div>

      <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="margin-bottom: 16px">
        <div>{{ error }}</div>
      </div>

      <form @submit.prevent="create">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="page-title">Tiêu đề bài viết / chính sách</label>
            <input
              id="page-title"
              v-model="form.title"
              class="form-input"
              required
              placeholder="Ví dụ: Quy định đổi trả & bảo hành trọn đời"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="page-slug">Slug định danh (URL path)</label>
            <input
              id="page-slug"
              v-model="form.slug"
              class="form-input"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="quy-dinh-doi-tra"
              style="font-family: var(--adm-mono)"
            />
            <span class="form-help">Chỉ dùng chữ thường, số và dấu gạch ngang (không thể sửa sau khi tạo).</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="page-kind">Phân loại nội dung</label>
          <select id="page-kind" v-model="form.kind" class="form-select" style="max-width: 320px">
            <option v-for="kind in ContentPageKind.options" :key="kind" :value="kind">
              {{ CONTENT_PAGE_KIND_LABELS[kind] }}
            </option>
          </select>
        </div>

        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px">
          <button type="button" class="btn btn-secondary" @click="showCreatePanel = false">Hủy</button>
          <button type="submit" class="btn btn-primary">Tạo và chuyển sang soạn thảo</button>
        </div>
      </form>
    </div>

    <div class="tab-filter-bar">
      <button class="tab-filter-btn" :class="{ active: selectedFilter === 'all' }" @click="selectedFilter = 'all'">
        Tất cả trang ({{ list.length }})
      </button>
      <button
        v-for="kind in ContentPageKind.options"
        :key="kind"
        class="tab-filter-btn"
        :class="{ active: selectedFilter === kind }"
        @click="selectedFilter = kind"
      >
        {{ CONTENT_PAGE_KIND_LABELS[kind] }} ({{ list.filter((p) => p.kind === kind).length }})
      </button>
    </div>

    <div class="admin-table-card">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Tiêu đề trang</th>
            <th>Slug (Đường dẫn)</th>
            <th>Phân loại</th>
            <th>Trạng thái xuất bản</th>
            <th style="text-align: right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredList.length">
            <td colspan="5" style="text-align: center; padding: 32px; color: var(--adm-muted)">
              Chưa có trang nội dung nào trong phân loại này.
            </td>
          </tr>
          <tr v-for="page in filteredList" :key="page.id">
            <td>
              <NuxtLink :to="`/admin/pages/${page.id}`" style="font-weight: 600">
                {{ page.title }}
              </NuxtLink>
            </td>
            <td>
              <code style="font-family: var(--adm-mono); font-size: 12px; color: var(--adm-ink-subtle)"
                >/trang/{{ page.slug }}</code
              >
            </td>
            <td>
              <span class="badge badge-role">{{ CONTENT_PAGE_KIND_LABELS[page.kind] }}</span>
            </td>
            <td>
              <span v-if="page.status === 'draft'" class="badge badge-draft">
                <span class="badge-dot"></span>
                Bản nháp
              </span>
              <div v-else style="display: flex; align-items: center; gap: 6px">
                <span class="badge badge-published">
                  <span class="badge-dot"></span>
                  Đã xuất bản (v{{ page.currentVersion }})
                </span>
                <span v-if="page.hasUnpublishedChanges" class="badge badge-draft" title="Có bản nháp chưa công bố">
                  Thay đổi chưa xuất bản
                </span>
              </div>
            </td>
            <td style="text-align: right">
              <NuxtLink :to="`/admin/pages/${page.id}`" class="btn btn-secondary btn-sm">
                Soạn thảo & Phiên bản
              </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>
