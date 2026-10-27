<script setup lang="ts">
import type { AttributeDefinition, AttributeValue } from '@ecommerce/shared'

/** Ô nhập một thuộc tính, sinh theo kiểu trong schema. Bỏ trống là `null`. */
const props = defineProps<{ definition: AttributeDefinition; disabled?: boolean }>()
const value = defineModel<AttributeValue | null | undefined>({ required: true })

const label = computed(() => {
  const unit = props.definition.type === 'number' && props.definition.unit ? ` (${props.definition.unit})` : ''
  return `${props.definition.label}${unit}${props.definition.required ? ' *' : ''}`
})

const selected = computed(() => (Array.isArray(value.value) ? value.value : []))

function toggle(option: string, checked: boolean) {
  value.value = checked ? [...selected.value, option] : selected.value.filter((v) => v !== option)
}

function setNumber(raw: string) {
  value.value = raw.trim() === '' ? null : Number(raw)
}
</script>

<template>
  <select
    v-if="definition.type === 'enum'"
    v-model="value"
    class="form-select"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
  >
    <option :value="null">—</option>
    <option v-for="option in definition.options" :key="option" :value="option">{{ option }}</option>
  </select>
  <fieldset v-else-if="definition.type === 'multi_enum'" class="flex flex-wrap gap-x-4 gap-y-1" :disabled="disabled">
    <legend class="sr-only">{{ label }}</legend>
    <label v-for="option in definition.options" :key="option" class="inline-flex items-center gap-1.5">
      <input
        type="checkbox"
        :checked="selected.includes(option)"
        @change="toggle(option, ($event.target as HTMLInputElement).checked)"
      />
      {{ option }}
    </label>
  </fieldset>
  <input
    v-else-if="definition.type === 'number'"
    class="form-input"
    type="number"
    step="any"
    :value="value ?? ''"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    @input="setNumber(($event.target as HTMLInputElement).value)"
  />
  <input
    v-else-if="definition.type === 'boolean'"
    v-model="value"
    type="checkbox"
    :aria-label="label"
    :disabled="disabled"
  />
  <input v-else v-model="value" class="form-input" :aria-label="label" :title="label" :disabled="disabled" />
</template>
