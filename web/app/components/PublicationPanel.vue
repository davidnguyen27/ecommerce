<script setup lang="ts">
import type { AdminProductDetail, FieldError } from '@ecommerce/shared'

type Target = 'published' | 'archived' | 'draft'

/** Trạng thái xuất bản và các nút vòng đời; lỗi chặn xuất bản do API trả, trang chuyển xuống qua `blockers`. */
defineProps<{ product: AdminProductDetail; blockers: FieldError[]; canEdit: boolean }>()
const emit = defineEmits<{ changeStatus: [status: Target, message: string] }>()
</script>

<template>
  <div class="admin-panel" style="border-top: 3px solid var(--adm-dark)">
    <h2 class="admin-section-title" style="margin-bottom: 12px">Trạm kiểm soát xuất bản</h2>

    <div style="background: var(--adm-surface-subtle); padding: 14px; border-radius: 6px; margin-bottom: 16px">
      <div
        style="
          font-size: 11px;
          color: var(--adm-muted);
          margin-bottom: 4px;
          text-transform: uppercase;
          font-weight: 600;
        "
      >
        Trạng thái hiển thị công khai:
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between">
        <ProductStatusBadge :status="product.status" style="font-size: 12px" />

        <NuxtLink
          v-if="product.liveVersion"
          :to="`/san-pham/${product.slug}`"
          target="_blank"
          class="btn btn-ghost btn-sm"
          style="padding: 2px 6px; font-size: 12px"
        >
          Xem trang live ↗
        </NuxtLink>
      </div>

      <div v-if="product.liveVersion" style="margin-top: 10px; font-size: 12px; color: var(--adm-muted)">
        Khách đang thấy phiên bản: <strong>v.{{ product.liveVersion.version }}</strong>
      </div>

      <div
        v-if="product.hasUnpublishedChanges"
        style="
          margin-top: 8px;
          padding: 6px 10px;
          background: var(--adm-draft-bg);
          border: 1px solid var(--adm-draft-border);
          border-radius: 4px;
          font-size: 12px;
          color: var(--adm-draft);
          font-weight: 500;
        "
      >
        ⚠ Có thay đổi trong bản soạn chưa được xuất bản.
      </div>
    </div>

    <div
      v-if="blockers.length"
      class="admin-alert admin-alert-danger"
      role="alert"
      style="font-size: 12px; margin-bottom: 14px; flex-direction: column; gap: 4px"
    >
      <strong>Không đủ điều kiện xuất bản:</strong>
      <ul style="margin: 0; padding-left: 18px">
        <li v-for="f in blockers" :key="f.path">{{ f.message }}</li>
      </ul>
    </div>

    <div v-if="canEdit" style="display: flex; flex-direction: column; gap: 8px">
      <button
        v-if="product.status === 'draft'"
        type="button"
        class="btn btn-primary"
        style="width: 100%; justify-content: center"
        @click="emit('changeStatus', 'published', 'Đã xuất bản sản phẩm')"
      >
        Xuất bản lên website
      </button>

      <button
        v-if="product.status === 'published'"
        type="button"
        class="btn btn-primary"
        style="width: 100%; justify-content: center"
        :disabled="!product.hasUnpublishedChanges"
        @click="emit('changeStatus', 'published', 'Đã xuất bản thay đổi mới')"
      >
        Xuất bản thay đổi mới
      </button>

      <button
        v-if="product.status !== 'archived'"
        type="button"
        class="btn btn-secondary"
        style="width: 100%; justify-content: center; color: var(--adm-archived)"
        @click="emit('changeStatus', 'archived', 'Đã chuyển vào lưu trữ')"
      >
        Lưu trữ sản phẩm
      </button>

      <button
        v-if="product.status === 'archived'"
        type="button"
        class="btn btn-secondary"
        style="width: 100%; justify-content: center"
        @click="emit('changeStatus', 'draft', 'Đã đưa về bản nháp')"
      >
        Đưa về bản nháp để sửa
      </button>
    </div>
  </div>
</template>
