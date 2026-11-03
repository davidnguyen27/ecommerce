<script setup lang="ts">
import { AccountOrderPage } from '@ecommerce/shared'

/** Mục "Đơn hàng của tôi" trong trang tài khoản: lịch sử mua, mới nhất trước, có phân trang. */
const session = useCustomerSession()
const page = ref(1)
const result = ref<AccountOrderPage | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    result.value = AccountOrderPage.parse(
      await session.accountFetch('/api/account/orders', { query: { page: page.value } }),
    )
    error.value = null
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(page, load)

const pageCount = computed(() => (result.value ? Math.ceil(result.value.total / result.value.pageSize) : 0))
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-6 sm:p-8" aria-labelledby="account-orders">
    <h2 id="account-orders">Đơn hàng của tôi</h2>
    <p v-if="error" class="notice-error mt-4" role="alert">{{ error }}</p>
    <p v-else-if="!result" class="mt-4 text-sm text-muted-foreground">Đang tải…</p>
    <p v-else-if="result.total === 0" class="mt-4 text-sm text-muted-foreground" data-testid="account-orders-empty">
      Bạn chưa có đơn hàng nào. Đơn đặt bằng email này trước khi đăng ký sẽ hiện ở đây sau khi bạn xác minh email.
    </p>
    <template v-else>
      <ul class="mt-4 divide-y divide-border border-y border-border text-sm">
        <li v-for="order in result.items" :key="order.code" data-testid="account-order">
          <NuxtLink
            :to="`/tai-khoan/don-hang/${order.code}`"
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 hover:bg-secondary/50"
          >
            <span>
              <span class="font-semibold">#{{ order.code }}</span>
              <span class="ml-2 text-muted-foreground">{{ formatDateTime(order.createdAt) }}</span>
            </span>
            <span class="text-muted-foreground">
              {{ ORDER_STATUS_LABELS[order.status] }} · {{ order.itemCount }} món
            </span>
            <span class="font-semibold tabular-nums">{{ formatVnd(order.total) }}</span>
          </NuxtLink>
        </li>
      </ul>
      <nav v-if="pageCount > 1" class="mt-4 flex items-center justify-between gap-4 text-sm" aria-label="Phân trang">
        <button type="button" class="btn-outline" :disabled="loading || page <= 1" @click="page--">Trang trước</button>
        <span class="text-muted-foreground">Trang {{ page }}/{{ pageCount }}</span>
        <button type="button" class="btn-outline" :disabled="loading || page >= pageCount" @click="page++">
          Trang sau
        </button>
      </nav>
    </template>
  </section>
</template>
