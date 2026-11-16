<script setup lang="ts">
import type { VoucherQuote } from '@ecommerce/shared'

/**
 * Ô nhập mã giảm giá ở trang đặt mua và đặt trước. Trang giữ mã đang áp (`code`) và gửi kèm báo giá; ô này chỉ nhận mã
 * khách gõ và hiện kết quả báo giá trả về.
 */
const props = defineProps<{ code: string | null; result: VoucherQuote | null; busy?: boolean }>()
const emit = defineEmits<{ apply: [code: string]; remove: [] }>()

const draft = ref('')
function apply() {
  const code = draft.value.trim()
  if (code) emit('apply', code)
}
watch(
  () => props.code,
  (code) => {
    if (code === null) draft.value = ''
  },
)
</script>

<template>
  <div class="mt-4 text-sm" data-testid="voucher-field">
    <div v-if="code && result?.applied" class="flex items-center justify-between gap-3">
      <span>
        Mã <strong class="font-mono">{{ result.code }}</strong> đã áp dụng
      </span>
      <button type="button" class="link" @click="emit('remove')">Gỡ mã</button>
    </div>
    <!-- Không dùng <form>: ô này nằm trong form đặt mua. Enter áp mã thay vì gửi đơn. -->
    <div v-else class="flex gap-2">
      <label class="sr-only" for="voucher-code">Mã giảm giá</label>
      <input
        id="voucher-code"
        v-model="draft"
        class="field-input h-9 flex-1 uppercase"
        placeholder="Mã giảm giá"
        maxlength="20"
        autocomplete="off"
        @keydown.enter.prevent="apply"
      />
      <button type="button" class="btn-outline h-9 px-4" :disabled="busy || !draft.trim()" @click="apply">
        Áp dụng
      </button>
    </div>
    <p v-if="code && result && !result.applied" class="mt-2 text-red-700" role="alert">
      {{ voucherReasonText(result.reason, result.shortfall) }}
    </p>
  </div>
</template>
