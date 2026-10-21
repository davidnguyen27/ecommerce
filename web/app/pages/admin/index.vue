<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

const session = useAdminSession()
const { data: me } = await useAsyncData('admin-me', () => session.fetchMe())
</script>

<template>
  <main>
    <header>
      <span v-if="me">{{ me.name }}</span>
      <button type="button" @click="session.logout()">Đăng xuất</button>
    </header>
  </main>
</template>
