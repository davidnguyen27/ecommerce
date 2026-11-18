<script setup lang="ts">
import type {
  ExchangeLineInput,
  ExchangeOptions,
  ReturnLineInput,
  SupportReturnReason,
  WarrantyLineInput,
} from '@ecommerce/shared'

/**
 * Chọn dòng của đơn đã giao cho yêu cầu trả (dòng, số lượng, lý do), đổi (dòng, số lượng, biến thể đổi sang) hay bảo
 * hành (một dòng, số lượng). Dùng ở form của khách và trang nhân viên tạo hộ (`admin`: kiểu của trang quản trị).
 * `v-model` là các dòng gửi lên API; rỗng là chưa chọn được gì. API kiểm lại mọi điều kiện.
 */
type Kind = 'return' | 'exchange' | 'warranty'
type PickedLines = ReturnLineInput[] | ExchangeLineInput[] | WarrantyLineInput[]

const props = defineProps<{
  kind: Kind
  lines: readonly { variantId: string; sku: string; productName: string; quantity: number }[]
  /** Biến thể đổi được của từng dòng; chỉ gọi khi chọn đổi hàng. */
  loadExchangeOptions: () => Promise<ExchangeOptions>
  admin?: boolean
}>()
const model = defineModel<PickedLines>({ required: true })

const select = computed(() => (props.admin ? 'form-select' : 'field-input'))
const muted = computed(() => (props.admin ? 'form-help' : 'text-muted-foreground'))

const picks = reactive<Record<string, { chosen: boolean; quantity: number; reason: SupportReturnReason }>>({})
const swaps = reactive<Record<string, { chosen: boolean; quantity: number; toVariantId: string }>>({})
const warranty = reactive({ variantId: '', quantity: 1 })
watch(
  () => props.lines,
  (lines) => {
    for (const line of lines) picks[line.variantId] ??= { chosen: false, quantity: 1, reason: 'wrong_fit' }
  },
  { immediate: true },
)

const exchange = ref<ExchangeOptions | null>(null)
const loadError = ref<string | null>(null)
watch(
  () => props.kind,
  async (kind) => {
    if (kind !== 'exchange' || exchange.value) return
    try {
      exchange.value = await props.loadExchangeOptions()
      for (const line of exchange.value.lines) {
        swaps[line.variantId] ??= { chosen: false, quantity: 1, toVariantId: line.options[0]?.variantId ?? '' }
      }
    } catch (err) {
      loadError.value = apiErrorMessage(err)
    }
  },
  { immediate: true },
)

const productName = (variantId: string) => props.lines.find((l) => l.variantId === variantId)?.productName
const warrantyLine = computed(() => props.lines.find((l) => l.variantId === warranty.variantId))

watchEffect(() => {
  model.value =
    props.kind === 'return'
      ? Object.entries(picks)
          .filter(([, p]) => p.chosen)
          .map(([variantId, p]) => ({ variantId, quantity: p.quantity, reason: p.reason }))
      : props.kind === 'exchange'
        ? Object.entries(swaps)
            .filter(([, s]) => s.chosen && s.toVariantId)
            .map(([variantId, s]) => ({ variantId, quantity: s.quantity, toVariantId: s.toVariantId }))
        : warranty.variantId
          ? [{ variantId: warranty.variantId, quantity: warranty.quantity }]
          : []
})
</script>

<template>
  <fieldset v-if="kind === 'return'" class="space-y-3" data-testid="support-return-lines">
    <legend :class="admin ? 'form-label' : 'font-medium'">Sản phẩm muốn trả</legend>
    <div v-for="line in lines" :key="line.variantId" class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2">
        <input v-model="picks[line.variantId]!.chosen" type="checkbox" :data-testid="`support-return-${line.sku}`" />
        {{ line.productName }} <span :class="muted">{{ line.sku }}</span>
      </label>
      <template v-if="picks[line.variantId]!.chosen">
        <select v-model.number="picks[line.variantId]!.quantity" :class="select" class="w-20" aria-label="Số lượng trả">
          <option v-for="q in line.quantity" :key="q" :value="q">{{ q }}</option>
        </select>
        <select v-model="picks[line.variantId]!.reason" :class="select" class="w-44" aria-label="Lý do trả">
          <option v-for="(label, value) in RETURN_REASON_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </template>
    </div>
  </fieldset>

  <fieldset v-else-if="kind === 'exchange'" class="space-y-3" data-testid="support-exchange-lines">
    <legend :class="admin ? 'form-label' : 'font-medium'">Sản phẩm muốn đổi</legend>
    <p :class="muted">Chỉ đổi được sang biến thể cùng giá, còn hàng. Cửa hàng gửi hàng mới sau khi nhận hàng cũ.</p>
    <p v-if="loadError" role="alert" :class="admin ? 'field-error-msg' : 'notice-error'">{{ loadError }}</p>
    <p v-else-if="!exchange" :class="muted">Đang tải…</p>
    <div v-for="line in exchange?.lines ?? []" :key="line.variantId" class="flex flex-wrap items-center gap-3">
      <template v-if="line.returnable > 0 && line.options.length > 0">
        <label class="flex items-center gap-2">
          <input
            v-model="swaps[line.variantId]!.chosen"
            type="checkbox"
            :data-testid="`support-exchange-${line.heldSku}`"
          />
          {{ productName(line.variantId) }} <span :class="muted">{{ line.heldSku }}</span>
        </label>
        <template v-if="swaps[line.variantId]!.chosen">
          <select
            v-model.number="swaps[line.variantId]!.quantity"
            :class="select"
            class="w-20"
            aria-label="Số lượng đổi"
          >
            <option v-for="q in line.returnable" :key="q" :value="q">{{ q }}</option>
          </select>
          <select
            v-model="swaps[line.variantId]!.toVariantId"
            :class="select"
            class="w-56"
            aria-label="Đổi sang"
            :data-testid="`support-exchange-to-${line.heldSku}`"
          >
            <option v-for="o in line.options" :key="o.variantId" :value="o.variantId">
              {{ o.label || o.sku }} ({{ o.sku }})
            </option>
          </select>
        </template>
      </template>
      <p v-else :class="muted">
        {{ productName(line.variantId) }} {{ line.heldSku }}:
        {{ line.returnable > 0 ? 'chưa có biến thể cùng giá còn hàng để đổi' : 'đã nằm trong yêu cầu khác' }}
      </p>
    </div>
  </fieldset>

  <fieldset v-else class="space-y-3" data-testid="support-warranty-line">
    <legend :class="admin ? 'form-label' : 'font-medium'">Sản phẩm bị lỗi</legend>
    <div class="flex flex-wrap items-center gap-3">
      <select
        v-model="warranty.variantId"
        :class="select"
        class="w-72"
        aria-label="Sản phẩm bị lỗi"
        @change="warranty.quantity = 1"
      >
        <option value="" disabled>Chọn sản phẩm</option>
        <option v-for="line in lines" :key="line.variantId" :value="line.variantId">
          {{ line.productName }} ({{ line.sku }})
        </option>
      </select>
      <select
        v-if="warrantyLine"
        v-model.number="warranty.quantity"
        :class="select"
        class="w-20"
        aria-label="Số lượng lỗi"
      >
        <option v-for="q in warrantyLine.quantity" :key="q" :value="q">{{ q }}</option>
      </select>
    </div>
    <p :class="muted">Mô tả lỗi ở phần nội dung; ảnh giúp cửa hàng kiểm tra nhanh hơn.</p>
  </fieldset>
</template>
