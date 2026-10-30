<script setup lang="ts">
import type { SizeChart } from '@ecommerce/shared'

/** Bảng size của sản phẩm: thêm, bớt cột và hàng. Lưu cùng thông tin sản phẩm nên chỉ báo `save` lên trang. */
defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ save: [] }>()
const chart = defineModel<SizeChart | null>({ required: true })

function addColumn(table: SizeChart) {
  table.columns.push('')
  table.rows.forEach((row) => row.push(''))
}

function removeColumn(table: SizeChart, index: number) {
  table.columns.splice(index, 1)
  table.rows.forEach((row) => row.splice(index, 1))
}

function addRow(table: SizeChart) {
  table.rows.push(table.columns.map(() => ''))
}
</script>

<template>
  <div class="admin-panel">
    <div class="admin-panel-header">
      <div>
        <h2 class="admin-section-title" style="margin: 0">Bảng kích thước (Size Chart)</h2>
        <p class="form-help" style="margin-top: 2px">Hướng dẫn quy đổi và đo size cho khách hàng.</p>
      </div>
      <div v-if="!disabled">
        <button
          v-if="!chart"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="chart = { columns: ['Size'], rows: [] }"
        >
          + Thêm bảng size
        </button>
        <button v-else type="button" class="btn btn-primary btn-sm" @click="emit('save')">Lưu bảng size</button>
      </div>
    </div>

    <div
      v-if="!chart"
      style="
        padding: 20px;
        text-align: center;
        color: var(--adm-muted);
        background: var(--adm-surface-subtle);
        border-radius: 6px;
      "
    >
      Sản phẩm chưa thiết lập bảng size.
    </div>

    <div v-else>
      <div style="overflow-x: auto; margin-bottom: 12px">
        <table class="admin-table" style="background: var(--adm-surface)">
          <thead>
            <tr>
              <th v-for="(_, col) in chart.columns" :key="col" style="padding: 6px 10px">
                <div style="display: flex; gap: 4px; align-items: center">
                  <input
                    v-model="chart.columns[col]"
                    class="form-input"
                    style="padding: 4px 6px; font-size: 12px; font-weight: 600"
                    placeholder="Tiêu đề"
                    :aria-label="`Tiêu đề cột ${col + 1}`"
                    required
                    :disabled="disabled"
                  />
                  <button
                    v-if="!disabled"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    style="padding: 2px 6px; color: var(--adm-danger)"
                    :aria-label="`Xóa cột ${col + 1}`"
                    :disabled="chart.columns.length === 1"
                    @click="removeColumn(chart, col)"
                  >
                    ✕
                  </button>
                </div>
              </th>
              <th style="width: 50px" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in chart.rows" :key="rowIndex">
              <td v-for="(_, col) in row" :key="col" style="padding: 6px 10px">
                <input
                  v-model="row[col]"
                  class="form-input"
                  style="padding: 4px 6px; font-size: 12px"
                  placeholder="Giá trị"
                  :aria-label="`${chart.columns[col] || `Cột ${col + 1}`}, hàng ${rowIndex + 1}`"
                  :disabled="disabled"
                />
              </td>
              <td style="text-align: center; padding: 6px">
                <button
                  v-if="!disabled"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  style="color: var(--adm-danger); padding: 2px 6px"
                  :aria-label="`Xóa hàng ${rowIndex + 1}`"
                  @click="chart.rows.splice(rowIndex, 1)"
                >
                  ✕
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!disabled" style="display: flex; gap: 8px">
        <button type="button" class="btn btn-secondary btn-sm" @click="addColumn(chart)">+ Thêm cột</button>
        <button type="button" class="btn btn-secondary btn-sm" @click="addRow(chart)">+ Thêm hàng</button>
        <button type="button" class="btn btn-danger btn-sm" @click="chart = null">Xóa toàn bộ bảng</button>
      </div>
    </div>
  </div>
</template>
