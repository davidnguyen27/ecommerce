<script setup lang="ts">
import type { PublicCommitment } from '@ecommerce/shared'

/**
 * Cam kết có bằng chứng trên trang chi tiết sản phẩm, đặt tách khỏi thông tin nguồn gốc công bố để khách biết
 * mức độ tin cậy. Dữ liệu lấy từ `GET /api/products/:slug/commitments` (hoặc phần `commitments` của API chi tiết
 * sản phẩm khi ticket 11 gộp vào). Không có cam kết thì không hiện gì, nên không bao giờ hiện bảo hành không căn cứ.
 */
defineProps<{ commitments: PublicCommitment[] }>()
</script>

<template>
  <section v-if="commitments.length > 0" class="evidenced" aria-labelledby="evidenced-heading">
    <h2 id="evidenced-heading">Cam kết có chứng từ</h2>
    <p class="note">Mỗi cam kết dưới đây dựa trên chứng từ nguồn hàng doanh nghiệp đang lưu giữ.</p>
    <ul>
      <li v-for="commitment in commitments" :key="commitment.type">
        <strong>
          <span class="badge">{{ commitment.kind === 'warranty' ? 'Bảo hành' : 'Đã xác minh' }}</span>
          {{ commitment.type }}
        </strong>
        <p>{{ commitment.statement }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.evidenced {
  border: 1px solid currentColor;
  padding: 1rem;
}
.badge {
  border: 1px solid currentColor;
  border-radius: 0.25rem;
  padding: 0 0.25rem;
  font-size: 0.8em;
}
.note {
  font-size: 0.9em;
}
</style>
