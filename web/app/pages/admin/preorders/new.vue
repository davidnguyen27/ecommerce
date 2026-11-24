<script setup lang="ts">
import {
  AdminProduct,
  AdminProductList,
  PreorderCampaign,
  type FieldError,
  type PreorderCampaignUpdate,
} from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'preorder.manage' })

const session = useAdminSession()
const error = ref<string | null>(null)
const errors = ref<FieldError[]>([])
const busy = ref(false)
const products = ref<AdminProductList['items']>([])
const productId = ref('')
const product = ref<AdminProduct | null>(null)

// Only published products can get a campaign.
try {
  const list = AdminProductList.parse(await session.adminFetch('/api/admin/products'))
  products.value = list.items.filter((p) => p.status === 'published').sort((a, b) => a.name.localeCompare(b.name))
} catch (err) {
  error.value = apiErrorMessage(err)
}

watch(productId, async (id) => {
  product.value = null
  errors.value = []
  if (!id) return
  try {
    product.value = AdminProduct.parse(await session.adminFetch(`/api/admin/products/${id}`))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
})

async function create(body: PreorderCampaignUpdate) {
  busy.value = true
  error.value = null
  try {
    const campaign = PreorderCampaign.parse(
      await session.adminFetch('/api/admin/preorder-campaigns', {
        method: 'POST',
        body: { ...body, productId: productId.value },
      }),
    )
    await navigateTo(`/admin/preorders/${campaign.id}`)
  } catch (err) {
    errors.value = apiFieldErrors(err)
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Mở đợt đặt trước</h1>
        <p class="admin-page-desc">
          Chỉ mở khi đã kiểm tra được khả năng cung ứng. Mức cọc và số ngày trả phần còn lại bị khóa khi đợt có đơn đầu
          tiên.
        </p>
      </div>
      <NuxtLink to="/admin/preorders" class="btn btn-secondary btn-sm">‹ Danh sách đợt</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-panel" style="padding: 16px 20px">
      <div class="form-group">
        <label class="form-label" for="preorder-product">Sản phẩm (đã xuất bản) *</label>
        <select id="preorder-product" v-model="productId" class="form-input">
          <option value="">— Chọn sản phẩm —</option>
          <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} · {{ p.brand.name }}</option>
        </select>
      </div>
      <AdminPreorderCampaignForm
        v-if="product"
        :key="product.id"
        :product="product"
        :busy="busy"
        :errors="errors"
        submit-label="Mở đợt"
        @submit="create"
        @cancel="navigateTo('/admin/preorders')"
      />
    </div>
  </div>
</template>
