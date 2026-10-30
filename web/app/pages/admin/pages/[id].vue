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
const activeTab = ref<'editor' | 'preview'>('editor')
const isSaving = ref(false)

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
  isSaving.value = true
  try {
    notice.value = await action()
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    isSaving.value = false
  }
}

function save() {
  return runWithNotice(async () => {
    show(ContentPageDetail.parse(await session.adminFetch(`/api/admin/pages/${id}`, { method: 'PUT', body: draft })))
    return 'Đã lưu bản nháp thành công trên máy chủ.'
  })
}

// Xuất bản bản nháp đã lưu trên máy chủ, nên nút chỉ bấm được khi không còn thay đổi chưa lưu.
function publish() {
  return runWithNotice(async () => {
    const version = ContentPageVersion.parse(
      await session.adminFetch(`/api/admin/pages/${id}/publish`, { method: 'POST' }),
    )
    await load()
    return `Đã xuất bản thành công phiên bản v${version.version}. Khách hàng có thể xem trực tuyến ngay.`
  })
}

function openVersion(version: number) {
  return runWithNotice(async () => {
    viewing.value = ContentPageVersion.parse(await session.adminFetch(`/api/admin/pages/${id}/versions/${version}`))
    return null
  })
}

await load()
</script>

<template>
  <main v-if="page">
    <div class="admin-page-header">
      <div>
        <div class="admin-breadcrumb" style="margin-bottom: 8px">
          <NuxtLink to="/admin/pages">Trang nội dung</NuxtLink>
          <span class="admin-breadcrumb-separator">/</span>
          <span class="admin-breadcrumb-current">{{ page.title }}</span>
        </div>
        <h1 class="admin-page-title">{{ page.title }}</h1>
        <p class="admin-page-desc">
          Định danh:
          <code style="font-family: var(--adm-mono); font-size: 13px; color: var(--adm-ink-subtle)">{{
            page.slug
          }}</code>
          · Phân loại: <span class="badge badge-role">{{ CONTENT_PAGE_KIND_LABELS[page.kind] }}</span>
        </p>
      </div>

      <div class="admin-topbar-actions">
        <a
          v-if="page.status === 'published'"
          :href="`/trang/${page.slug}`"
          target="_blank"
          rel="noopener"
          class="btn btn-secondary btn-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          Xem trên website
        </a>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <div>{{ error }}</div>
    </div>

    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <div>{{ notice }}</div>
    </div>

    <div class="admin-two-col">
      <section>
        <div class="admin-panel" style="padding-bottom: 24px">
          <div class="form-group">
            <label class="form-label" for="edit-title">Tiêu đề bài viết</label>
            <input
              id="edit-title"
              v-model="draft.title"
              class="form-input"
              required
              style="font-weight: 600; font-size: 15px"
            />
          </div>

          <div class="tab-filter-bar" style="margin-bottom: 14px">
            <button
              type="button"
              class="tab-filter-btn"
              :class="{ active: activeTab === 'editor' }"
              @click="activeTab = 'editor'"
            >
              Soạn thảo Markdown
            </button>
            <button
              type="button"
              class="tab-filter-btn"
              :class="{ active: activeTab === 'preview' }"
              @click="activeTab = 'preview'"
            >
              Xem trước giao diện
            </button>
          </div>

          <div v-show="activeTab === 'editor'">
            <div class="form-group" style="margin-bottom: 0">
              <textarea
                v-model="draft.body"
                rows="24"
                class="form-textarea"
                placeholder="Nhập nội dung theo định dạng Markdown (H2 ##, H3 ###, danh sách -, liên kết [link](url)...)"
                style="font-family: var(--adm-mono); font-size: 13px; line-height: 1.6; resize: vertical"
              ></textarea>
              <span class="form-help">Hỗ trợ đầy đủ cú pháp CommonMark, bảng biểu và trích dẫn chuẩn.</span>
            </div>
          </div>

          <div
            v-show="activeTab === 'preview'"
            style="
              border: 1px solid var(--adm-border);
              border-radius: 6px;
              padding: 24px 28px;
              background: #ffffff;
              min-height: 480px;
              font-size: 14px;
              line-height: 1.7;
            "
          >
            <!-- renderMarkdown đã thoát HTML trong nội dung -->
            <article class="markdown-preview" v-html="preview" />
          </div>
        </div>

        <div v-if="viewing" class="admin-panel" style="border-left: 3px solid var(--adm-ink); margin-top: 24px">
          <div class="admin-panel-header">
            <div>
              <h3 class="admin-section-title" style="margin-bottom: 2px">
                Đang xem lại: Phiên bản {{ viewing.version }} — {{ viewing.title }}
              </h3>
              <span class="form-help">
                Xuất bản lúc {{ formatDateTime(viewing.publishedAt) }} bởi {{ viewing.publishedBy.name }}
              </span>
            </div>
            <button class="btn btn-secondary btn-sm" @click="viewing = null">Đóng bản xem lại</button>
          </div>
          <div
            style="
              background: var(--adm-surface-subtle);
              padding: 20px;
              border-radius: 6px;
              font-size: 14px;
              line-height: 1.7;
            "
          >
            <!-- renderMarkdown đã thoát HTML trong nội dung -->
            <article v-html="viewingHtml" />
          </div>
        </div>
      </section>

      <aside>
        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin-bottom: 2px">Trạng thái phát hành</h2>
              <span class="form-help">Điều khiển phiên bản hiển thị cho khách</span>
            </div>
          </div>

          <div style="margin-bottom: 16px">
            <div style="font-size: 12px; color: var(--adm-muted); margin-bottom: 4px">Hiện tại:</div>
            <div v-if="page.status === 'draft'">
              <span class="badge badge-draft">
                <span class="badge-dot"></span>
                Bản nháp (Khách chưa thấy)
              </span>
            </div>
            <div v-else>
              <div style="display: flex; flex-direction: column; gap: 4px">
                <span class="badge badge-published">
                  <span class="badge-dot"></span>
                  Đã công bố (Phiên bản v{{ page.currentVersion }})
                </span>
                <span v-if="page.hasUnpublishedChanges" class="badge badge-draft">
                  Bản nháp đang có thay đổi chưa phát hành
                </span>
              </div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px">
            <button
              type="button"
              class="btn btn-secondary"
              style="width: 100%"
              :disabled="!dirty || isSaving"
              @click="save"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              {{ isSaving ? 'Đang lưu...' : 'Lưu bản nháp' }}
            </button>

            <button
              type="button"
              class="btn btn-primary"
              style="width: 100%"
              :disabled="dirty || isSaving"
              @click="publish"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
              Xuất bản phiên bản mới
            </button>

            <p v-if="dirty" style="font-size: 11px; color: var(--adm-draft); margin: 0; text-align: center">
              * Bạn cần lưu nháp trước khi tiến hành xuất bản phiên bản mới.
            </p>
          </div>
        </div>

        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin-bottom: 2px">Lịch sử phiên bản</h2>
              <span class="form-help">Nhật ký các lần xuất bản trang</span>
            </div>
            <span class="badge badge-neutral tnum">{{ versions.length }} bản ghi</span>
          </div>

          <div v-if="!versions.length" style="color: var(--adm-muted); font-size: 12px; padding: 12px 0">
            Chưa có phiên bản nào được xuất bản trước đây.
          </div>

          <div v-else style="display: flex; flex-direction: column; gap: 8px">
            <div
              v-for="v in versions"
              :key="v.id"
              style="
                border: 1px solid var(--adm-border-subtle);
                border-radius: 6px;
                padding: 10px 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 12px;
              "
            >
              <div>
                <div style="font-weight: 600; color: var(--adm-ink); margin-bottom: 2px">
                  v{{ v.version }} · {{ v.title }}
                </div>
                <div style="color: var(--adm-muted); font-size: 11px">
                  {{ formatDateTime(v.publishedAt) }} · {{ v.publishedBy.name }}
                </div>
              </div>

              <button
                type="button"
                class="btn btn-ghost btn-sm"
                style="padding: 4px 8px; font-size: 11px"
                @click="openVersion(v.version)"
              >
                Đọc lại
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </main>
</template>
