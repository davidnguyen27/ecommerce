<script setup lang="ts">
import { PROVINCES, ShippingFeeConfig, type FieldError } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'price.edit' })

type Form = {
  defaultFee: number | null
  hasFreeShipping: boolean
  freeShippingThreshold: number | null
  provinceFees: { provinceCode: string; fee: number | null }[]
}

const session = useAdminSession()
const form = ref<Form>(toForm(ShippingFeeConfig.parse(await session.adminFetch('/api/admin/shipping-fees'))))
const configured = ref(form.value.defaultFee !== null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const formErrors = ref<FieldError[]>([])
const isSaving = ref(false)
const errorAt = (path: string) => formErrors.value.find((f) => f.path === path)?.message

// Tỉnh/thành sắp theo tên để dễ tìm trong danh sách chọn.
const provinceOptions = [...PROVINCES].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
const usedCodes = computed(() => new Set(form.value.provinceFees.map((f) => f.provinceCode)))

function toForm(config: ShippingFeeConfig): Form {
  return {
    defaultFee: config.defaultFee,
    hasFreeShipping: config.freeShippingThreshold !== null,
    freeShippingThreshold: config.freeShippingThreshold,
    provinceFees: config.provinceFees.map((f) => ({ ...f })),
  }
}

function addProvince() {
  const next = provinceOptions.find((p) => !usedCodes.value.has(p.code))
  if (next) form.value.provinceFees.push({ provinceCode: next.code, fee: null })
}

async function save() {
  error.value = null
  notice.value = null
  formErrors.value = []
  isSaving.value = true
  try {
    const body = {
      defaultFee: form.value.defaultFee,
      freeShippingThreshold: form.value.hasFreeShipping ? form.value.freeShippingThreshold : null,
      provinceFees: form.value.provinceFees,
    }
    const saved = ShippingFeeConfig.parse(await session.adminFetch('/api/admin/shipping-fees', { method: 'PUT', body }))
    form.value = toForm(saved)
    configured.value = true
    notice.value = 'Đã lưu phí giao. Báo giá và đơn mới tính theo cấu hình này; đơn đã đặt giữ phí lúc đặt.'
  } catch (err) {
    error.value = apiErrorMessage(err)
    formErrors.value = apiFieldErrors(err)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <main>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Phí giao</h1>
        <p class="admin-page-desc">
          Một mức mặc định cho mọi tỉnh/thành, mức riêng cho từng tỉnh/thành nếu cần, và ngưỡng miễn phí giao theo tổng
          tiền hàng. Tất cả tính bằng VND.
        </p>
      </div>
      <div class="admin-topbar-actions">
        <button type="submit" form="shipping-fee-form" class="btn btn-primary" :disabled="isSaving">
          {{ isSaving ? 'Đang lưu...' : 'Lưu thay đổi' }}
        </button>
      </div>
    </div>

    <div v-if="!configured" class="admin-alert admin-alert-danger" role="alert">
      <div>Chưa có mức phí giao mặc định: khách chưa đặt mua được (cửa hàng chưa sẵn sàng nhận đơn).</div>
    </div>
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <div>{{ error }}</div>
    </div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <div>{{ notice }}</div>
    </div>

    <form id="shipping-fee-form" @submit.prevent="save">
      <div class="form-grid-2">
        <div class="admin-panel">
          <h2 class="admin-section-title">Mức chung</h2>
          <div class="form-group">
            <label class="form-label" for="defaultFee">Phí giao mặc định (₫)</label>
            <input
              id="defaultFee"
              v-model.number="form.defaultFee"
              type="number"
              min="0"
              step="1000"
              class="form-input"
              required
            />
            <div class="form-help">Áp dụng cho tỉnh/thành không có mức riêng.</div>
            <small class="field-error-msg">{{ errorAt('defaultFee') }}</small>
          </div>

          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 8px">
              <input v-model="form.hasFreeShipping" type="checkbox" />
              Miễn phí giao khi tổng tiền hàng đạt ngưỡng
            </label>
          </div>
          <div v-if="form.hasFreeShipping" class="form-group">
            <label class="form-label" for="freeShippingThreshold">Ngưỡng miễn phí giao (₫)</label>
            <input
              id="freeShippingThreshold"
              v-model.number="form.freeShippingThreshold"
              type="number"
              min="0"
              step="1000"
              class="form-input"
              required
            />
            <div class="form-help">Tổng tiền hàng từ mức này trở lên thì phí giao bằng 0, ở mọi tỉnh/thành.</div>
            <small class="field-error-msg">{{ errorAt('freeShippingThreshold') }}</small>
          </div>
        </div>

        <div class="admin-panel">
          <h2 class="admin-section-title">Mức riêng theo tỉnh/thành</h2>
          <p v-if="form.provinceFees.length === 0" class="form-help">
            Chưa có mức riêng: mọi tỉnh/thành dùng mức mặc định.
          </p>
          <table v-else class="admin-table">
            <thead>
              <tr>
                <th>Tỉnh/thành</th>
                <th class="admin-table-num" style="min-width: 140px">Phí giao (₫)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in form.provinceFees" :key="index">
                <td>
                  <select v-model="row.provinceCode" aria-label="Tỉnh/thành" class="form-select" required>
                    <option
                      v-for="p in provinceOptions"
                      :key="p.code"
                      :value="p.code"
                      :disabled="p.code !== row.provinceCode && usedCodes.has(p.code)"
                    >
                      {{ p.fullName }}
                    </option>
                  </select>
                  <small class="field-error-msg">{{ errorAt(`provinceFees.${index}.provinceCode`) }}</small>
                </td>
                <td>
                  <input
                    v-model.number="row.fee"
                    aria-label="Phí giao"
                    type="number"
                    min="0"
                    step="1000"
                    class="form-input admin-table-num"
                    required
                  />
                  <small class="field-error-msg">{{ errorAt(`provinceFees.${index}.fee`) }}</small>
                </td>
                <td style="text-align: right">
                  <button type="button" class="btn btn-secondary btn-sm" @click="form.provinceFees.splice(index, 1)">
                    Xóa
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            style="margin-top: 12px"
            :disabled="usedCodes.size >= PROVINCES.length"
            @click="addProvince"
          >
            + Thêm mức riêng
          </button>
        </div>
      </div>
    </form>
  </main>
</template>
