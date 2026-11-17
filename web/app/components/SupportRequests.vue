<script setup lang="ts">
import type { PublicSupportSummary } from '@ecommerce/shared'

/**
 * Danh sách yêu cầu hỗ trợ của khách và form gửi yêu cầu mới (spec M6b). Dùng ở trang đơn (yêu cầu của đơn) và trang
 * tài khoản (mọi yêu cầu của khách). `orderCode` có ở trang đơn trong tài khoản để gắn yêu cầu vào đơn.
 */
const props = defineProps<{ client: SupportClient; orderCode?: number; title?: string }>()

const items = ref<PublicSupportSummary[] | null>(null)
const error = ref<string | null>(null)
const open = ref(false)
const sending = ref(false)
const form = reactive({ subject: '', message: '' })
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
    const created = await props.client.create({
      kind: 'other',
      subject: form.subject,
      message: form.message,
      ...(props.orderCode !== undefined && { orderCode: props.orderCode }),
    })
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
        <button type="submit" class="btn-primary" :disabled="sending" data-testid="support-submit">
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
