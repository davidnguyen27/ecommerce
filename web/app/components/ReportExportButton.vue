<script setup lang="ts">
// Nút "Xuất Excel" của một tab báo cáo: tải `/api/admin/reports/<name>.xlsx` theo bộ lọc đang chọn (qua `adminFetch`
// để có token), rồi lưu với tên `bao-cao-<slug>-<from>-<to>.xlsx` như API đặt.
const props = defineProps<{
  name: string
  slug: string
  query: { from: string; to: string } & Record<string, string | number | undefined>
}>()

const session = useAdminSession()
const busy = ref(false)
const error = ref<string | null>(null)

async function download() {
  busy.value = true
  error.value = null
  try {
    const blob = (await session.adminFetch(`/api/admin/reports/${props.name}.xlsx`, {
      query: props.query,
      responseType: 'blob',
    })) as Blob
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bao-cao-${props.slug}-${props.query.from}-${props.query.to}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div style="display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-bottom: 12px">
    <span v-if="error" role="alert" style="font-size: 12px; color: #b91c1c">{{ error }}</span>
    <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="download">
      {{ busy ? 'Đang xuất…' : 'Xuất Excel' }}
    </button>
  </div>
</template>
