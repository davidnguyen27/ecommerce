<script setup lang="ts">
import type { PublicSupportRequest } from '@ecommerce/shared'

// Yêu cầu hỗ trợ của khách vãng lai: mở bằng mã đơn và token tra cứu đơn trong link email (`?don=…&token=…`), hoặc
// token đã nhớ của tab đặt mua. Dữ liệu cá nhân: chỉ nạp ở trình duyệt.
const route = useRoute()
const code = computed(() => Number(route.params.code))
const orderCode = computed(() => (typeof route.query.don === 'string' ? Number(route.query.don) : NaN))
const token = computed(() =>
  typeof route.query.token === 'string' ? route.query.token : recallOrderToken(String(orderCode.value)),
)
const request = ref<PublicSupportRequest | null>(null)
const error = ref<string | null>(null)
const client = computed(() =>
  token.value && Number.isInteger(orderCode.value) ? guestSupportClient(orderCode.value, token.value) : null,
)

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
      <p class="mt-8 text-sm">
        <NuxtLink :to="`/don-hang/${orderCode}?token=${encodeURIComponent(token!)}`"
          >‹ Về đơn hàng #{{ orderCode }}</NuxtLink
        >
      </p>
    </template>
  </main>
</template>
