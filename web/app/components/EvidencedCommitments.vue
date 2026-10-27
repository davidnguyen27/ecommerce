<script setup lang="ts">
import type { PublicCommitment } from '@ecommerce/shared'
import { ShieldCheck } from 'lucide-vue-next'

/**
 * Cam kết có bằng chứng trên trang chi tiết sản phẩm, đặt tách khỏi thông tin nguồn gốc công bố để khách biết
 * mức độ tin cậy. Dữ liệu là phần `commitments` của `GET /api/products/:slug`.
 * Không có cam kết thì không hiện gì, nên không bao giờ hiện bảo hành không căn cứ.
 */
defineProps<{ commitments: PublicCommitment[] }>()
</script>

<template>
  <section
    v-if="commitments.length > 0"
    class="scroll-mt-28 rounded-lg border border-highlight/30 bg-highlight/[0.04] p-6"
    aria-labelledby="evidenced-heading"
  >
    <h2 id="evidenced-heading" class="flex items-center gap-2">
      <ShieldCheck class="h-5 w-5 text-highlight" aria-hidden="true" />
      Cam kết có chứng từ
    </h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Mỗi cam kết dưới đây dựa trên chứng từ nguồn hàng doanh nghiệp đang lưu giữ.
    </p>
    <ul class="mt-4 space-y-4">
      <li v-for="commitment in commitments" :key="commitment.type" class="border-t border-highlight/20 pt-4">
        <strong class="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span
            class="rounded-full bg-highlight px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-highlight-foreground"
            >{{ COMMITMENT_KIND_BADGES[commitment.kind] }}</span
          >
          {{ commitment.type }}
        </strong>
        <p class="mt-1.5 text-sm leading-6">{{ commitment.statement }}</p>
      </li>
    </ul>
  </section>
</template>
