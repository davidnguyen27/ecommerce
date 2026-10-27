<script setup lang="ts">
import { LegalInfo } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'content.edit' })

const session = useAdminSession()
const form = ref<LegalInfo>(LegalInfo.parse(await session.adminFetch('/api/admin/legal-info')))
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const isSaving = ref(false)

async function save() {
  error.value = null
  notice.value = null
  isSaving.value = true
  try {
    form.value = LegalInfo.parse(await session.adminFetch('/api/admin/legal-info', { method: 'PUT', body: form.value }))
    notice.value = 'Đã lưu thông tin pháp lý thành công. Chân trang toàn hệ thống đã được đồng bộ.'
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <main>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Thông tin pháp lý & Bộ Công Thương</h1>
        <p class="admin-page-desc">
          Cấu hình thông tin doanh nghiệp theo giấy phép kinh doanh và đường dẫn chứng thực của Bộ Công Thương
          (online.gov.vn) xuất hiện tại chân trang toàn hệ thống.
        </p>
      </div>
      <div class="admin-topbar-actions">
        <button type="submit" form="legal-form" class="btn btn-primary" :disabled="isSaving">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          {{ isSaving ? 'Đang lưu...' : 'Lưu thay đổi' }}
        </button>
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

    <form id="legal-form" @submit.prevent="save">
      <div class="form-grid-2">
        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin-bottom: 2px">Giấy phép đăng ký doanh nghiệp</h2>
              <span class="form-help">Thông tin pháp nhân đăng ký thương mại điện tử</span>
            </div>
            <span class="badge badge-draft">Pháp nhân</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="companyName">Tên doanh nghiệp</label>
            <input
              id="companyName"
              v-model="form.companyName"
              class="form-input"
              required
              placeholder="CÔNG TY CỔ PHẦN THỜI TRANG..."
            />
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label" for="businessRegistrationNumber">Mã số doanh nghiệp (GPKD)</label>
              <input
                id="businessRegistrationNumber"
                v-model="form.businessRegistrationNumber"
                class="form-input"
                required
                placeholder="0101234567"
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="businessRegistrationIssuedOn">Ngày cấp</label>
              <input
                id="businessRegistrationIssuedOn"
                v-model="form.businessRegistrationIssuedOn"
                type="date"
                class="form-input"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="businessRegistrationIssuedBy">Nơi cấp</label>
            <input
              id="businessRegistrationIssuedBy"
              v-model="form.businessRegistrationIssuedBy"
              class="form-input"
              placeholder="Sở Kế hoạch và Đầu tư..."
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="address">Địa chỉ trụ sở đăng ký</label>
            <textarea
              id="address"
              v-model="form.address"
              class="form-textarea"
              rows="2"
              placeholder="Số nhà, phố, quận/huyện, tỉnh/thành phố..."
            />
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label" for="phone">Số điện thoại liên hệ</label>
              <input id="phone" v-model="form.phone" type="tel" class="form-input" placeholder="024 3828 xxxx" />
            </div>
            <div class="form-group">
              <label class="form-label" for="email">Hòm thư điện tử (Email)</label>
              <input id="email" v-model="form.email" type="email" class="form-input" placeholder="contact@atelier.vn" />
            </div>
          </div>
        </div>

        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin-bottom: 2px">Chứng nhận Bộ Công Thương (MoIT)</h2>
              <span class="form-help">Tuân thủ quy định tại online.gov.vn</span>
            </div>
            <span class="badge badge-published">Chứng thực</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="moitLogoUrl">Đường dẫn ảnh logo "Đã thông báo Bộ Công Thương"</label>
            <input
              id="moitLogoUrl"
              v-model="form.moitLogoUrl"
              type="url"
              class="form-input"
              placeholder="https://cdn.domain.com/badges/bo-cong-thuong.png"
            />
            <div class="form-help">Huy hiệu chính thức do Bộ Công Thương cấp khi hoàn tất đăng ký.</div>
          </div>

          <div class="form-group">
            <label class="form-label" for="moitNoticeUrl">Đường dẫn hồ sơ thông báo trên online.gov.vn</label>
            <input
              id="moitNoticeUrl"
              v-model="form.moitNoticeUrl"
              type="url"
              class="form-input"
              placeholder="http://online.gov.vn/Home/WebDetails/..."
            />
            <div class="form-help">Khách hàng nhấn vào huy hiệu sẽ được dẫn trực tiếp đến trang xác minh này.</div>
          </div>

          <div class="form-group" style="margin-top: 24px">
            <label class="form-label">Xem trước logo hiển thị</label>
            <div
              style="
                background-color: var(--adm-surface-subtle);
                border: 1px dashed var(--adm-border);
                border-radius: 6px;
                padding: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100px;
              "
            >
              <template v-if="form.moitLogoUrl">
                <a v-if="form.moitNoticeUrl" :href="form.moitNoticeUrl" target="_blank" rel="noopener noreferrer">
                  <img
                    :src="form.moitLogoUrl"
                    alt="Logo Bộ Công Thương"
                    style="max-height: 60px; object-fit: contain"
                  />
                </a>
                <img
                  v-else
                  :src="form.moitLogoUrl"
                  alt="Logo Bộ Công Thương"
                  style="max-height: 60px; object-fit: contain"
                />
              </template>
              <span v-else style="font-size: 12px; color: var(--adm-muted)">Chưa có đường dẫn ảnh logo</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  </main>
</template>
