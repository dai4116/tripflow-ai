<template>
  <label class="base-field" :class="{ 'base-field--error': error }">
    <span v-if="label">{{ label }}</span>
    <div class="base-field__control" :class="{ 'base-field__control--area': multiline }">
      <AppIcon v-if="icon" :name="icon" :size="15" />
      <textarea
        v-if="multiline"
        :placeholder="placeholder"
        :rows="rows"
        :value="modelValue"
        @input="emitValue"
      />
      <input
        v-else
        :type="type"
        :placeholder="placeholder"
        :value="modelValue"
        :min="min"
        :max="max"
        @input="emitValue"
      />
    </div>
    <small v-if="error" class="base-field__error">{{ error }}</small>
  </label>
</template>

<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{
    label?: string
    modelValue?: string | number
    placeholder?: string
    type?: string
    multiline?: boolean
    rows?: number
    icon?: IconName
    min?: number
    max?: number
    error?: string
  }>(),
  {
    type: 'text',
    rows: 4,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function emitValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}
</script>
