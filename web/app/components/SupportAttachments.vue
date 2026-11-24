<script setup lang="ts">
import type { SupportAttachmentView } from '@ecommerce/shared'

/**
 * A message's attachments: thumbnails that open full size in a new tab. Signed URLs live 5 minutes; reload for new
 * ones.
 */
defineProps<{ attachments: SupportAttachmentView[] }>()
</script>

<template>
  <ul v-if="attachments.length" class="mt-2 flex flex-wrap gap-2" style="list-style: none; padding: 0">
    <li v-for="a in attachments" :key="a.id" data-testid="support-attachment">
      <a :href="a.url" target="_blank" rel="noopener noreferrer">
        <img
          :src="a.url"
          alt="Ảnh đính kèm"
          width="96"
          height="96"
          loading="lazy"
          style="width: 96px; height: 96px; object-fit: cover; border-radius: 4px"
        />
      </a>
    </li>
  </ul>
</template>
