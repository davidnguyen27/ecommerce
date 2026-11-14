<script setup lang="ts">
// Trang đặt trước một biến thể (ADR 0012). Ticket 04 làm form đặt trước và thanh toán cọc; tới lúc đó trang chỉ báo
// chưa mở, để nút "Đặt trước" ở trang sản phẩm không dẫn tới trang lỗi.
useSeo({ title: 'Đặt trước', description: 'Đặt trước sản phẩm chưa có hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    <h1>Đặt trước</h1>
    <div class="mt-8 rounded-lg border border-border bg-card p-8 text-center">
      <p class="text-muted-foreground">
        Tính năng đặt trước trên website sắp mở. Vui lòng liên hệ cửa hàng để đặt hàng.
      </p>
      <NuxtLink to="/" class="btn-primary mt-5">Tiếp tục mua sắm</NuxtLink>
    </div>
  </main>
</template>
