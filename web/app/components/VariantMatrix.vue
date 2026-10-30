<script setup lang="ts">
import { VariantStatus, type AttributeDefinition } from '@ecommerce/shared'
import type { TargetedFieldErrors, VariantDraft } from '~/utils/productDraft'

/**
 * Bảng biến thể đang soạn, dòng cuối là dòng thêm mới. Mỗi dòng lưu riêng nên chỉ báo `save` lên trang.
 * Tồn chỉ đọc ở đây, đổi ở trang Kho.
 */
const props = defineProps<{
  definitions: AttributeDefinition[]
  /** Tồn theo id biến thể đã lưu, theo lần tải gần nhất. */
  onHand: ReadonlyMap<string, number>
  errors: TargetedFieldErrors
  canEdit: boolean
  canPrice: boolean
}>()
const emit = defineEmits<{ save: [variant: VariantDraft] }>()
const variants = defineModel<VariantDraft[]>('variants', { required: true })
const newVariant = defineModel<VariantDraft>('newVariant', { required: true })

const errorAt = (variant: VariantDraft, path: string) => fieldErrorAt(props.errors, variant.id, path)

/** Ô giá: chuỗi rỗng là chưa đặt giá. */
function setPrice(variant: VariantDraft, field: 'price' | 'compareAtPrice', raw: string) {
  variant[field] = raw.trim() === '' ? null : Number(raw)
}
</script>

<template>
  <div class="admin-panel">
    <div class="admin-panel-header">
      <div>
        <h2 class="admin-section-title" style="margin: 0">Ma trận Biến thể (Variants & SKUs)</h2>
        <p class="form-help" style="margin-top: 2px">
          Quản lý SKU duy nhất, thuộc tính riêng biệt (Màu, Size, Dung tích), giá bán và giá hãng.
          <span v-if="!canPrice" style="color: var(--adm-draft)"> (Bạn không có quyền sửa giá).</span>
        </p>
      </div>
    </div>

    <div style="overflow-x: auto">
      <table class="admin-table">
        <thead>
          <tr>
            <th style="min-width: 130px">SKU *</th>
            <th v-for="d in definitions" :key="d.key">{{ d.label }}</th>
            <th style="min-width: 110px">Trạng thái</th>
            <th style="min-width: 120px" class="admin-table-num">Giá bán (₫)</th>
            <th style="min-width: 120px" class="admin-table-num">Giá hãng (₫)</th>
            <th style="min-width: 70px" class="admin-table-num">Tồn</th>
            <th style="text-align: right; min-width: 90px">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="v in [...variants, newVariant]"
            :key="v.id || 'new'"
            :style="{ background: !v.id ? 'var(--adm-surface-subtle)' : undefined }"
          >
            <td>
              <input
                v-model="v.sku"
                class="form-input"
                style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600"
                :placeholder="!v.id ? '+ SKU MỚI' : 'SKU'"
                aria-label="SKU"
                required
                :disabled="!canEdit"
              />
              <small v-for="path in ['sku', 'attributes', 'status']" :key="path" class="field-error-msg">
                {{ errorAt(v, path) }}
              </small>
            </td>

            <td v-for="d in definitions" :key="d.key">
              <AttributeInput v-model="v.attributes[d.key]" :definition="d" :disabled="!canEdit" />
              <small v-if="errorAt(v, `attributes.${d.key}`)" class="field-error-msg">
                {{ errorAt(v, `attributes.${d.key}`) }}
              </small>
            </td>

            <td>
              <select
                v-model="v.status"
                class="form-select"
                style="font-size: 12px"
                aria-label="Trạng thái bán"
                :disabled="!canEdit"
              >
                <option v-for="s in VariantStatus.options" :key="s" :value="s">
                  {{ VARIANT_STATUS_LABELS[s] }}
                </option>
              </select>
            </td>

            <td>
              <input
                type="number"
                min="1"
                step="1000"
                class="form-input admin-table-num"
                style="font-weight: 600"
                :value="v.price ?? ''"
                placeholder="Chưa đặt"
                aria-label="Giá bán"
                :disabled="!canPrice"
                @input="setPrice(v, 'price', ($event.target as HTMLInputElement).value)"
              />
              <small v-if="errorAt(v, 'price')" class="field-error-msg">
                {{ errorAt(v, 'price') }}
              </small>
            </td>

            <td>
              <input
                type="number"
                min="1"
                step="1000"
                class="form-input admin-table-num"
                :value="v.compareAtPrice ?? ''"
                placeholder="Không có"
                aria-label="Giá hãng"
                :disabled="!canPrice"
                @input="setPrice(v, 'compareAtPrice', ($event.target as HTMLInputElement).value)"
              />
              <small v-if="errorAt(v, 'compareAtPrice')" class="field-error-msg">
                {{ errorAt(v, 'compareAtPrice') }}
              </small>
            </td>

            <td class="admin-table-num">
              <NuxtLink
                v-if="v.id && onHand.has(v.id)"
                :to="`/admin/stock/movements?variantId=${v.id}`"
                title="Xem sổ xuất nhập của biến thể"
                style="font-weight: 600"
              >
                {{ onHand.get(v.id) }}
              </NuxtLink>
              <span v-else style="color: var(--adm-muted)">—</span>
            </td>

            <td style="text-align: right">
              <button v-if="v.id" type="button" class="btn btn-secondary btn-sm" @click="emit('save', v)">Lưu</button>
              <button v-else-if="canEdit" type="button" class="btn btn-primary btn-sm" @click="emit('save', v)">
                + Thêm
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
