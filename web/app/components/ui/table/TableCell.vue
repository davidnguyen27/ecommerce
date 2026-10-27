<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <td
    :class="cn('p-3 px-3.5 align-middle [&:has([role=checkbox])]:pr-0 [font-feature-settings:\'tnum\']', props.class)"
  >
    <slot />
  </td>
</template>
