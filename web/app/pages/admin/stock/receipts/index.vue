<script setup lang="ts">
import { STOCK_VIEW_PERMISSIONS, StockPage, StockReceipt, StockReceiptPage, type FieldError } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: STOCK_VIEW_PERMISSIONS })

const PAGE_SIZE = 50

const session = useAdminSession()
const canReceive = computed(() => session.can('stock.adjust'))
const result = ref<StockReceiptPage | null>(null)
const page = ref(1)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

async function load() {
  error.value = null
  try {
    result.value = StockReceiptPage.parse(
      await session.adminFetch('/api/admin/stock/receipts', { query: { page: page.value, pageSize: PAGE_SIZE } }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function goTo(target: number) {
  page.value = target
  return load()
}

const lastPage = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / PAGE_SIZE)))

// Form tạo phiếu: mỗi dòng nhập SKU thì tra tên sản phẩm và tồn hiện tại, để nhân viên thấy mình nhập đúng mã.

type Line = { sku: string; quantity: number | null; found: { productName: string; onHand: number } | null | undefined }
const today = () => new Date().toLocaleDateString('sv-SE')
const emptyLine = (): Line => ({ sku: '', quantity: null, found: undefined })
const form = ref<{ supplierName: string; receivedOn: string; note: string; lines: Line[] } | null>(null)
const formErrors = ref<FieldError[]>([])

function openForm() {
  form.value = { supplierName: '', receivedOn: today(), note: '', lines: [emptyLine()] }
  formErrors.value = []
  notice.value = null
}

/** `undefined` là chưa tra, `null` là không có SKU này. */
async function lookUp(line: Line) {
  const sku = line.sku.trim().toUpperCase()
  if (!sku) return (line.found = undefined)
  try {
    const matches = StockPage.parse(await session.adminFetch('/api/admin/stock', { query: { q: sku, pageSize: 5 } }))
    const item = matches.items.find((i) => i.sku === sku)
    line.found = item ? { productName: item.product.name, onHand: item.onHand } : null
  } catch {
    line.found = undefined
  }
}

const errorAt = (path: string) => formErrors.value.find((f) => f.path === path)?.message

async function save() {
  const f = form.value
  if (!f) return
  error.value = null
  const body = {
    supplierName: f.supplierName,
    receivedOn: f.receivedOn,
    note: f.note,
    lines: f.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
  }
  try {
    const receipt = StockReceipt.parse(await session.adminFetch('/api/admin/stock/receipts', { method: 'POST', body }))
    notice.value = `Đã ghi phiếu nhập ${receipt.lines.length} dòng từ ${receipt.supplierName}`
    form.value = null
    page.value = 1
    await load()
  } catch (err) {
    formErrors.value = apiFieldErrors(err)
    error.value = apiErrorMessage(err)
  }
}

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Phiếu nhập kho</h1>
        <p class="admin-page-desc">
          Mỗi phiếu ghi một lô hàng về kho. Phiếu được ghi toàn bộ hoặc không dòng nào, và không sửa được sau khi ghi;
          nhập sai thì làm điều chỉnh ở trang Tồn kho.
        </p>
      </div>
      <button v-if="canReceive && !form" type="button" class="btn btn-primary btn-sm" @click="openForm">
        + Tạo phiếu nhập
      </button>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>{{ notice }}</span>
    </div>

    <div v-if="form" class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <form @submit.prevent="save">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px">
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="receipt-form-supplier-name">Nhà cung cấp *</label>
            <input
              id="receipt-form-supplier-name"
              v-model="form.supplierName"
              class="form-input"
              required
              maxlength="200"
            />
            <small class="field-error-msg">{{ errorAt('supplierName') }}</small>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="receipt-form-received-on">Ngày hàng về *</label>
            <input id="receipt-form-received-on" v-model="form.receivedOn" type="date" class="form-input" required />
          </div>
          <div class="form-group" style="margin-bottom: 0; grid-column: span 2">
            <label class="form-label" for="receipt-form-note">Ghi chú</label>
            <input id="receipt-form-note" v-model="form.note" class="form-input" maxlength="1000" />
          </div>
        </div>

        <table class="admin-table" style="margin-top: 16px">
          <thead>
            <tr>
              <th style="min-width: 160px">SKU</th>
              <th>Sản phẩm</th>
              <th class="admin-table-num">Tồn hiện tại</th>
              <th class="admin-table-num" style="min-width: 110px">Số lượng nhập</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in form.lines" :key="index">
              <td>
                <input
                  v-model="line.sku"
                  class="form-input"
                  style="font-family: var(--adm-mono); font-size: 12px"
                  required
                  @change="lookUp(line)"
                />
                <small class="field-error-msg">{{ errorAt(`lines.${index}.sku`) }}</small>
              </td>
              <td style="font-size: 12px">
                <span v-if="line.found">{{ line.found.productName }}</span>
                <span v-else-if="line.found === null" style="color: #b91c1c">Không có SKU này</span>
                <span v-else style="color: var(--adm-muted)">—</span>
              </td>
              <td class="admin-table-num">{{ line.found?.onHand ?? '—' }}</td>
              <td>
                <input
                  v-model.number="line.quantity"
                  type="number"
                  min="1"
                  step="1"
                  class="form-input admin-table-num"
                  required
                />
                <small class="field-error-msg">{{ errorAt(`lines.${index}.quantity`) }}</small>
              </td>
              <td style="text-align: right">
                <button
                  v-if="form.lines.length > 1"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="form.lines.splice(index, 1)"
                >
                  Xóa dòng
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <small class="field-error-msg">{{ errorAt('lines') }}</small>

        <div style="display: flex; gap: 8px; margin-top: 12px">
          <button type="button" class="btn btn-secondary btn-sm" @click="form.lines.push(emptyLine())">
            + Thêm dòng
          </button>
          <button type="submit" class="btn btn-primary btn-sm">Ghi phiếu nhập</button>
          <button type="button" class="btn btn-secondary btn-sm" @click="form = null">Hủy</button>
        </div>
      </form>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Chưa có phiếu nhập nào.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Ngày hàng về</th>
                <th>Nhà cung cấp</th>
                <th class="admin-table-num">Số dòng</th>
                <th class="admin-table-num">Tổng số lượng</th>
                <th>Ghi chú</th>
                <th>Người ghi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in result.items" :key="r.id">
                <td style="white-space: nowrap">
                  <NuxtLink :to="`/admin/stock/receipts/${r.id}`" style="font-weight: 600">
                    {{ formatDateOnly(r.receivedOn) }}
                  </NuxtLink>
                </td>
                <td>{{ r.supplierName }}</td>
                <td class="admin-table-num">{{ r.lineCount }}</td>
                <td class="admin-table-num">{{ r.totalQuantity }}</td>
                <td style="font-size: 12px">{{ r.note || '—' }}</td>
                <td style="font-size: 12px">{{ r.createdBy.name }}</td>
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
          "
        >
          <div style="font-size: 12px; color: var(--adm-muted)">
            Trang <strong>{{ page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} phiếu)
          </div>
          <div style="display: flex; gap: 8px">
            <button type="button" class="btn btn-secondary btn-sm" :disabled="page <= 1" @click="goTo(page - 1)">
              ‹ Trang trước
            </button>
            <button type="button" class="btn btn-secondary btn-sm" :disabled="page >= lastPage" @click="goTo(page + 1)">
              Trang sau ›
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
