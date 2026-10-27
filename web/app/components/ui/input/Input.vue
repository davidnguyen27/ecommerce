<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  modelValue?: string | number
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void
}>()
</script>

<template>
  <input
    :value="modelValue"
    :class="
      cn(
        'flex h-8 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
        props.class,
      )
    "
    @input="emits('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
