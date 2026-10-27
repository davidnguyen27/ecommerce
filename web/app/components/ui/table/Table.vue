<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div class="relative w-full overflow-auto rounded-md border border-border bg-card">
    <table :class="cn('w-full caption-bottom text-xs', props.class)">
      <slot />
    </table>
  </div>
</template>
