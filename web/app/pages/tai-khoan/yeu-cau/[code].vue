<script setup lang="ts">
import type { PublicSupportRequest } from '@ecommerce/shared'

// Yêu cầu hỗ trợ trong tài khoản: phiên khách chỉ có ở trình duyệt nên nạp sau khi mount.
const route = useRoute()
const code = computed(() => Number(route.params.code))
const session = useCustomerSession()
const client = accountSupportClient(session.accountFetch)
const request = ref<PublicSupportRequest | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  if (!(await session.signedIn())) return void (await navigateTo('/dang-nhap'))
  try {
    request.value = await client.get(code.value)
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
    <template v-else>
      <SupportThread :request="request" :client="client" @update="request = $event" />
      <p class="mt-8 text-sm"><NuxtLink to="/tai-khoan">‹ Về tài khoản</NuxtLink></p>
    </template>
  </main>
</template>
