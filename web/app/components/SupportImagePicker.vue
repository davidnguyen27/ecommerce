<script setup lang="ts">
import { SUPPORT_IMAGE_MAX_BYTES, SUPPORT_IMAGES_PER_MESSAGE } from '@ecommerce/shared'

/**
 * Picks up to 5 images (jpeg, png, webp, ≤ 5 MB) for a message, with previews and per-image removal (spec M6b). The
 * browser only pre-checks so customers do not wait; the API checks the real content. Shared by customer and admin
 * pages.
 */
const files = defineModel<File[]>({ required: true })
const props = defineProps<{ inputId: string; admin?: boolean }>()
const error = ref<string | null>(null)

const previews = computed(() => files.value.map((file) => ({ file, url: URL.createObjectURL(file) })))
watch(previews, (_now, before) => before?.forEach((p) => URL.revokeObjectURL(p.url)))
onBeforeUnmount(() => previews.value.forEach((p) => URL.revokeObjectURL(p.url)))

function pick(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = [...(input.files ?? [])]
  input.value = ''
  error.value = null
  const accepted = chosen.filter((file) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      error.value = `${file.name} không phải ảnh jpeg, png hoặc webp`
      return false
    }
    if (file.size > SUPPORT_IMAGE_MAX_BYTES) {
      error.value = `${file.name} vượt quá ${SUPPORT_IMAGE_MAX_BYTES / 1024 / 1024} MB`
      return false
    }
    return true
  })
  const room = SUPPORT_IMAGES_PER_MESSAGE - files.value.length
  if (accepted.length > room) error.value = `Mỗi tin tối đa ${SUPPORT_IMAGES_PER_MESSAGE} ảnh`
  files.value = [...files.value, ...accepted.slice(0, Math.max(0, room))]
}

const remove = (index: number) => (files.value = files.value.filter((_, i) => i !== index))
</script>

<template>
  <div data-testid="support-image-picker">
    <label :for="props.inputId" :class="props.admin ? 'form-label' : 'text-sm font-medium'">
      Ảnh đính kèm (tối đa {{ SUPPORT_IMAGES_PER_MESSAGE }} ảnh, mỗi ảnh ≤
      {{ SUPPORT_IMAGE_MAX_BYTES / 1024 / 1024 }} MB)
    </label>
    <input
      :id="props.inputId"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      :disabled="files.length >= SUPPORT_IMAGES_PER_MESSAGE"
      class="mt-1 block text-sm"
      data-testid="support-image-input"
      @change="pick"
    />
    <p v-if="error" role="alert" :class="props.admin ? 'field-error-msg' : 'notice-error mt-2'">{{ error }}</p>
    <ul v-if="previews.length" class="mt-2 flex flex-wrap gap-2" style="list-style: none; padding: 0">
      <li v-for="(p, i) in previews" :key="p.url" class="relative">
        <img
          :src="p.url"
          :alt="p.file.name"
          width="72"
          height="72"
          style="width: 72px; height: 72px; object-fit: cover"
        />
        <button type="button" class="text-xs underline" :aria-label="`Bỏ ảnh ${p.file.name}`" @click="remove(i)">
          Bỏ
        </button>
      </li>
    </ul>
  </div>
</template>
