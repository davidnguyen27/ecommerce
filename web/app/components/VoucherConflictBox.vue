<script setup lang="ts">
import type { VoucherConflict } from '@ecommerce/shared'

/**
 * Hộp chọn khi đặt bị 409 về mã: lý do, các khoản khi không dùng mã (đặt trước có thêm tiền cọc), và hai lựa chọn. Tiền
 * giảm chỉ đổi (`changed`) thì báo giá mới đã hiện số mới, chỉ cần quay lại xác nhận.
 */
defineProps<{ conflict: VoucherConflict; submitting: boolean }>()
const emit = defineEmits<{ proceed: []; back: [] }>()
</script>

<template>
  <div
    class="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm"
    role="alertdialog"
    aria-labelledby="voucher-conflict-title"
    data-testid="voucher-conflict"
  >
    <p id="voucher-conflict-title" class="font-medium">
      {{ voucherReasonText(conflict.reason, conflict.shortfall) }}
      <template v-if="conflict.discount !== null">: giảm {{ formatVnd(conflict.discount) }}</template>
    </p>
    <p class="mt-1 text-muted-foreground">
      Khi không dùng mã: tổng phải trả {{ formatVnd(conflict.totalWithoutVoucher)
      }}<template v-if="conflict.depositAmountWithoutVoucher !== undefined"
        >, cọc ngay {{ formatVnd(conflict.depositAmountWithoutVoucher) }}</template
      >.
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        v-if="conflict.reason !== 'changed'"
        type="button"
        class="btn-primary h-9 px-4"
        :disabled="submitting"
        @click="emit('proceed')"
      >
        Đặt không dùng mã
      </button>
      <button type="button" class="btn-outline h-9 px-4" @click="emit('back')">Quay lại</button>
    </div>
  </div>
</template>
