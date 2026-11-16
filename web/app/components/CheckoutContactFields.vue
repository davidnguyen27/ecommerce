<script setup lang="ts">
import { PROVINCES } from '@ecommerce/shared'
import type { Ward } from '@ecommerce/shared/wards'
import type { InvoiceFields, ShippingFormFields } from '~/composables/useShippingForm'

/** Các ô thông tin nhận hàng, ghi chú và hóa đơn công ty của trang đặt mua và đặt trước (`useShippingForm`). */
const form = defineModel<ShippingFormFields>('form', { required: true })
const invoice = defineModel<InvoiceFields>('invoice', { required: true })
const invoiceOpen = defineModel<boolean>('invoiceOpen', { required: true })
defineProps<{ wards: Ward[]; fieldErrors: Map<string, string> }>()
</script>

<template>
  <section class="space-y-5" aria-label="Thông tin nhận hàng">
    <h2>Thông tin nhận hàng</h2>
    <label class="field">
      Họ tên người nhận
      <input v-model="form.recipientName" class="field-input" name="name" autocomplete="name" required />
      <span v-if="fieldErrors.get('address.recipientName')" class="text-sm text-red-700">{{
        fieldErrors.get('address.recipientName')
      }}</span>
    </label>
    <div class="grid gap-5 sm:grid-cols-2">
      <label class="field">
        Số điện thoại
        <input
          v-model="form.phone"
          class="field-input"
          type="tel"
          name="tel"
          autocomplete="tel"
          inputmode="tel"
          required
        />
        <span v-if="fieldErrors.get('address.phone')" class="text-sm text-red-700">{{
          fieldErrors.get('address.phone')
        }}</span>
      </label>
      <label class="field">
        Email
        <input
          v-model="form.email"
          class="field-input"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          required
        />
        <span v-if="fieldErrors.get('address.email')" class="text-sm text-red-700">{{
          fieldErrors.get('address.email')
        }}</span>
      </label>
    </div>
    <div class="grid gap-5 sm:grid-cols-2">
      <!-- Label tách khỏi select: bọc thì tên truy cập của ô lẫn chữ của các option. -->
      <div class="field">
        <label for="checkout-province">Tỉnh/thành</label>
        <select id="checkout-province" v-model="form.provinceCode" class="field-input" name="province" required>
          <option value="" disabled>Chọn tỉnh/thành</option>
          <option v-for="p in PROVINCES" :key="p.code" :value="p.code">{{ p.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="checkout-ward">Phường/xã</label>
        <select
          id="checkout-ward"
          v-model="form.wardCode"
          class="field-input"
          name="ward"
          required
          :disabled="!wards.length"
        >
          <option value="" disabled>{{ form.provinceCode ? 'Chọn phường/xã' : 'Chọn tỉnh/thành trước' }}</option>
          <option v-for="w in wards" :key="w.code" :value="w.code">{{ w.name }}</option>
        </select>
        <span v-if="fieldErrors.get('address.wardCode')" class="text-sm text-red-700">{{
          fieldErrors.get('address.wardCode')
        }}</span>
      </div>
    </div>
    <label class="field">
      Số nhà, tên đường
      <input v-model="form.streetAddress" class="field-input" name="street" autocomplete="address-line1" required />
    </label>
    <label class="field">
      Ghi chú cho đơn (không bắt buộc)
      <textarea v-model="form.note" class="field-input min-h-24 py-2" name="note" maxlength="1000" />
    </label>

    <details
      class="rounded-lg border border-border bg-card"
      data-testid="invoice"
      :open="invoiceOpen"
      @toggle="invoiceOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary class="cursor-pointer px-5 py-4 font-medium">Xuất hóa đơn công ty (không bắt buộc)</summary>
      <div class="space-y-5 px-5 pb-5">
        <label class="field">
          Tên công ty
          <input v-model="invoice.companyName" class="field-input" name="companyName" autocomplete="organization" />
          <span v-if="fieldErrors.get('invoice.companyName')" class="text-sm text-red-700">{{
            fieldErrors.get('invoice.companyName')
          }}</span>
        </label>
        <label class="field">
          Mã số thuế
          <input
            v-model="invoice.taxCode"
            class="field-input"
            name="taxCode"
            inputmode="numeric"
            placeholder="0101234567 hoặc 0101234567-001"
          />
          <span v-if="fieldErrors.get('invoice.taxCode')" class="text-sm text-red-700">{{
            fieldErrors.get('invoice.taxCode')
          }}</span>
        </label>
        <label class="field">
          Địa chỉ xuất hóa đơn
          <input v-model="invoice.address" class="field-input" name="invoiceAddress" />
          <span v-if="fieldErrors.get('invoice.address')" class="text-sm text-red-700">{{
            fieldErrors.get('invoice.address')
          }}</span>
        </label>
      </div>
    </details>
  </section>
</template>
