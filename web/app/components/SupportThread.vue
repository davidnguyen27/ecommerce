<script setup lang="ts">
import type { PublicSupportRequest } from '@ecommerce/shared'

/** Một yêu cầu hỗ trợ như khách thấy: chuỗi tin, trạng thái, ô trả lời (spec M6b). Gửi tin xong emit yêu cầu mới. */
const props = defineProps<{ request: PublicSupportRequest; client: SupportClient }>()
const emit = defineEmits<{ update: [request: PublicSupportRequest] }>()

const message = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
const closed = computed(() => isSupportClosed(props.request.status))

async function send() {
  sending.value = true
  error.value = null
  try {
    emit('update', await props.client.say(props.request.code, message.value))
    message.value = ''
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    sending.value = false
  }
}

const authorLabel = (author: string) => (author === 'customer' ? 'Bạn' : author === 'staff' ? 'Cửa hàng' : 'Hệ thống')
</script>

<template>
  <section class="space-y-4" data-testid="support-thread">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1>#YC{{ request.code }} · {{ request.subject }}</h1>
      <span class="rounded-full bg-muted px-3 py-1 text-sm font-semibold" data-testid="support-status">
        {{ SUPPORT_STATUS_CUSTOMER_LABELS[request.status] }}
      </span>
    </div>
    <p class="text-sm text-muted-foreground">
      {{ SUPPORT_KIND_LABELS[request.kind] }}
      <template v-if="request.orderCode"> · đơn #{{ request.orderCode }}</template>
      · gửi lúc {{ formatDateTime(request.createdAt) }}
      <template v-if="request.previousRequestCode"> · tiếp theo yêu cầu #YC{{ request.previousRequestCode }}</template>
    </p>

    <ol class="space-y-3">
      <li
        v-for="m in request.messages"
        :key="m.id"
        class="rounded-lg border border-border p-4 text-sm"
        :class="m.author === 'customer' ? 'bg-card' : 'bg-muted/50'"
        data-testid="support-message-item"
      >
        <div class="mb-1 text-xs text-muted-foreground">
          {{ authorLabel(m.author) }} · {{ formatDateTime(m.createdAt) }}
        </div>
        <p class="whitespace-pre-line">{{ m.body }}</p>
      </li>
    </ol>

    <p v-if="closed" class="rounded-md border border-border bg-card px-4 py-3 text-sm" role="status">
      Yêu cầu đã kết thúc. Nếu cần thêm, bạn hãy gửi yêu cầu mới.
    </p>
    <form v-else class="space-y-3" @submit.prevent="send">
      <label class="field">
        Trả lời
        <textarea
          v-model="message"
          class="field-input min-h-24"
          maxlength="5000"
          required
          data-testid="support-reply"
        />
      </label>
      <p v-if="error" role="alert" class="notice-error">{{ error }}</p>
      <button
        type="submit"
        class="btn-primary"
        :disabled="sending || !message.trim()"
        data-testid="support-reply-submit"
      >
        {{ sending ? 'Đang gửi…' : 'Gửi' }}
      </button>
    </form>
  </section>
</template>
