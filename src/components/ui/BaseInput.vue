<template>
  <label ref="rootEl" class="base-field" :class="{ 'base-field--error': error }">
    <span v-if="label">{{ label }}</span>
    <div class="base-field__control" :class="{ 'base-field__control--area': multiline }">
      <AppIcon v-if="icon" :name="icon" :size="15" />
      <textarea
        v-if="multiline"
        ref="fieldEl"
        :placeholder="placeholder"
        :rows="rows"
        :value="modelValue"
        @input="emitValue"
      />
      <input
        v-else
        ref="fieldEl"
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
import { ref } from 'vue'
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

const rootEl = ref<HTMLLabelElement | null>(null)
const fieldEl = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

// Called by a parent's failed-validation handler so the user lands right on
// the field that needs attention, not just a red outline somewhere off-screen.
function focus() {
  rootEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  fieldEl.value?.focus({ preventScroll: true })
}

defineExpose({ focus })
</script>
