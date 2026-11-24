<script setup lang="ts">
import type { PublicSupportRequest } from '@ecommerce/shared'

// A guest's support request: opened with the order code and lookup token from the email link (`?don=…&token=…`), or the
// checkout tab's remembered token. Requests without an order (chatbot handoff, M8) open with their own token
// (`?token=…`, no `don`). Personal data: loaded only in the browser.
const route = useRoute()
const code = computed(() => Number(route.params.code))
const orderCode = computed(() => (typeof route.query.don === 'string' ? Number(route.query.don) : NaN))
const token = computed(() =>
  typeof route.query.token === 'string' ? route.query.token : recallOrderToken(String(orderCode.value)),
)
const request = ref<PublicSupportRequest | null>(null)
const error = ref<string | null>(null)
const client = computed(() => {
  if (token.value && Number.isInteger(orderCode.value)) return guestSupportClient(orderCode.value, token.value)
  return route.query.don === undefined && typeof route.query.token === 'string'
    ? contactSupportClient(route.query.token)
    : null
})

onMounted(async () => {
  if (!client.value) return void (error.value = 'Link không đủ thông tin. Hãy mở yêu cầu từ email hoặc trang đơn hàng.')
  try {
    request.value = await client.value.get(code.value)
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
})

useSeo({ title: () => `Yêu cầu #YC${code.value}`, description: 'Yêu cầu hỗ trợ của bạn.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-2xl px-4 py-12 sm:py-16">
    <p v-if="error" role="alert" class="notice-error">{{ error }}</p>
    <p v-else-if="!request" class="text-muted-foreground">Đang tải…</p>
    <template v-else-if="client">
      <SupportThread :request="request" :client="client" @update="request = $event" />
      <p v-if="Number.isInteger(orderCode)" class="mt-8 text-sm">
        <NuxtLink :to="`/don-hang/${orderCode}?token=${encodeURIComponent(token!)}`"
          >‹ Về đơn hàng #{{ orderCode }}</NuxtLink
        >
      </p>
    </template>
  </main>
</template>
