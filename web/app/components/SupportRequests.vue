<script setup lang="ts">
import type {
  CreatableSupportKind,
  CreateSupportRequest,
  OrderLineView,
  PublicSupportSummary,
  SupportReturnReason,
} from '@ecommerce/shared'

/**
 * Danh sách yêu cầu hỗ trợ của khách và form gửi yêu cầu mới (spec M6b). Dùng ở trang đơn (yêu cầu của đơn) và trang
 * tài khoản (mọi yêu cầu của khách). `orderCode` có ở trang đơn trong tài khoản để gắn yêu cầu vào đơn.
 */
const props = defineProps<{
  client: SupportClient
  orderCode?: number
  title?: string
  /** Đơn đang xem gửi được yêu cầu hủy (`canRequestCancel`): hiện loại "Hủy đơn" (spec M6b ticket 03). */
  canCancel?: boolean
  /** Dòng của đơn đã giao: có thì hiện loại "Trả hàng" và cho chọn dòng muốn trả (ticket 04). */
  returnLines?: OrderLineView[]
}>()

const canReturn = computed(() => (props.returnLines?.length ?? 0) > 0)
// Mỗi dòng đơn: có trả không, bao nhiêu, vì sao. API kiểm lại số còn trả được.
const picks = reactive<Record<string, { chosen: boolean; quantity: number; reason: SupportReturnReason }>>({})
watch(
  () => props.returnLines,
  (lines) => {
    for (const line of lines ?? []) picks[line.variantId] ??= { chosen: false, quantity: 1, reason: 'wrong_fit' }
  },
  { immediate: true },
)
const chosenLines = computed(() =>
  Object.entries(picks)
    .filter(([, p]) => p.chosen)
    .map(([variantId, p]) => ({ variantId, quantity: p.quantity, reason: p.reason })),
)

const items = ref<PublicSupportSummary[] | null>(null)
const error = ref<string | null>(null)
const open = ref(false)
const sending = ref(false)
const form = reactive({ kind: 'other' as CreatableSupportKind, subject: '', message: '' })
const images = ref<File[]>([])
// Yêu cầu đã tạo mà có ảnh gửi không được: vẫn mở được yêu cầu, báo ảnh nào lỗi.
const createdLink = ref<string | null>(null)

async function load() {
  try {
    items.value = await props.client.list()
    error.value = null
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}
onMounted(load)

async function submit() {
  sending.value = true
  error.value = null
  try {
    const base = {
      subject: form.subject,
      message: form.message,
      ...(props.orderCode !== undefined && { orderCode: props.orderCode }),
    }
    const body: CreateSupportRequest =
      form.kind === 'return' ? { ...base, kind: 'return', lines: chosenLines.value } : { ...base, kind: form.kind }
    const created = await props.client.create(body)
    // Ảnh gắn vào tin đầu tiên của yêu cầu vừa tạo.
    const firstMessage = created.messages[0]!.id
    const uploaded = await attachAll((file) => props.client.attach(created.code, firstMessage, file), images.value)
    if (uploaded.error) {
      error.value = uploaded.error
      createdLink.value = props.client.linkTo(created.code)
      return
    }
    await navigateTo(props.client.linkTo(created.code))
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5 text-sm" data-testid="support-requests">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-semibold">{{ title ?? 'Yêu cầu hỗ trợ' }}</h2>
      <button v-if="!open" type="button" class="btn-outline" data-testid="support-open-form" @click="open = true">
        Gửi yêu cầu
      </button>
    </div>

    <p v-if="error" role="alert" class="notice-error mt-3">
      {{ error }}
      <NuxtLink v-if="createdLink" :to="createdLink" class="link">Mở yêu cầu đã gửi</NuxtLink>
    </p>

    <form v-if="open" class="mt-4 space-y-4" data-testid="support-form" @submit.prevent="submit">
      <label v-if="canCancel || canReturn" class="field">
        Bạn cần gì
        <select v-model="form.kind" class="field-input" data-testid="support-kind">
          <option value="other">Hỏi hoặc nhờ việc khác</option>
          <option v-if="canCancel" value="cancel">Hủy đơn đã thanh toán</option>
          <option v-if="canReturn" value="return">Trả hàng</option>
        </select>
      </label>
      <fieldset v-if="form.kind === 'return'" class="space-y-3" data-testid="support-return-lines">
        <legend class="font-medium">Sản phẩm muốn trả</legend>
        <div v-for="line in returnLines" :key="line.variantId" class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2">
            <input
              v-model="picks[line.variantId]!.chosen"
              type="checkbox"
              :data-testid="`support-return-${line.sku}`"
            />
            {{ line.productName }} <span class="text-muted-foreground">{{ line.sku }}</span>
          </label>
          <template v-if="picks[line.variantId]!.chosen">
            <select v-model.number="picks[line.variantId]!.quantity" class="field-input w-20" aria-label="Số lượng trả">
              <option v-for="q in line.quantity" :key="q" :value="q">{{ q }}</option>
            </select>
            <select v-model="picks[line.variantId]!.reason" class="field-input w-44" aria-label="Lý do trả">
              <option v-for="(label, value) in RETURN_REASON_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </template>
        </div>
      </fieldset>
      <p v-if="form.kind === 'cancel'" class="text-muted-foreground">
        Cửa hàng sẽ hủy đơn và báo số tiền hoàn theo chính sách đã áp dụng cho đơn.
      </p>
      <label class="field">
        Tiêu đề
        <input v-model="form.subject" class="field-input" maxlength="200" required data-testid="support-subject" />
      </label>
      <label class="field">
        Nội dung
        <textarea
          v-model="form.message"
          class="field-input min-h-28"
          maxlength="5000"
          required
          data-testid="support-message"
        />
      </label>
      <SupportImagePicker v-model="images" input-id="support-new-images" />
      <div class="flex gap-3">
        <button
          type="submit"
          class="btn-primary"
          :disabled="sending || (form.kind === 'return' && chosenLines.length === 0)"
          data-testid="support-submit"
        >
          {{ sending ? 'Đang gửi…' : 'Gửi yêu cầu' }}
        </button>
        <button type="button" class="btn-outline" :disabled="sending" @click="open = false">Thôi</button>
      </div>
    </form>

    <p v-if="items && items.length === 0 && !open" class="mt-3 text-muted-foreground">Chưa có yêu cầu nào.</p>
    <ul v-if="items?.length" class="mt-3 divide-y divide-border">
      <li v-for="item in items" :key="item.code" class="py-2" data-testid="support-request-item">
        <NuxtLink :to="client.linkTo(item.code)" class="flex flex-wrap items-center justify-between gap-2">
          <span>
            <span class="font-semibold">#YC{{ item.code }}</span> {{ item.subject }}
            <span v-if="item.orderCode" class="text-muted-foreground"> · đơn #{{ item.orderCode }}</span>
          </span>
          <span class="text-muted-foreground">{{ SUPPORT_STATUS_CUSTOMER_LABELS[item.status] }}</span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
