<script setup lang="ts">
import { ApiErrorBody, HealthResponse } from '@ecommerce/shared'

const { apiBase } = useRuntimeConfig()

// Gọi API ngay lúc render phía server; trình duyệt nhận lại kết quả qua payload.
// apiBase chỉ có ở server; ở trình duyệt nó rỗng nên request đi cùng tên miền qua Caddy.
const { data, error } = await useAsyncData('health', async () => {
  const body = await $fetch('/healthz', { baseURL: apiBase })
  return HealthResponse.parse(body)
})

const errorCode = computed(() => {
  const body = ApiErrorBody.safeParse(error.value?.data)
  return body.success ? body.data.error.code : 'UNREACHABLE'
})
</script>

<template>
  <main>
    <h1>Trạng thái hệ thống</h1>
    <p v-if="data">API: {{ data.status }} · Cơ sở dữ liệu: {{ data.db }}</p>
    <p v-else>API đang lỗi: {{ errorCode }}</p>
  </main>
</template>
