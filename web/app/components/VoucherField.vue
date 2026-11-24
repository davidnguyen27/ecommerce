<script setup lang="ts">
import type { VoucherQuote } from '@ecommerce/shared'

/**
 * Voucher field on the checkout and pre-order pages. The page holds the applied code (`code`) and sends it with the
 * quote; this field only takes the typed code and shows the quote's result.
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
    <!-- No <form>: this sits inside the checkout form. Enter applies the code instead of placing the order. -->
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
