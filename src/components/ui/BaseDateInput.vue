<template>
  <label class="base-field date-field" :class="{ 'base-field--error': error }">
    <span v-if="label">{{ label }}</span>
    <div class="base-field__control date-field__control" @click="openPicker">
      <AppIcon name="calendar" :size="15" />
      <span class="date-field__value" aria-hidden="true">{{ formattedValue }}</span>
      <input ref="inputEl" type="date" :min="min" :value="modelValue" @input="onInput" />
    </div>
    <small v-if="error" class="base-field__error">{{ error }}</small>
  </label>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  label?: string
  modelValue?: string
  min?: string
  error?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputEl = ref<HTMLInputElement | null>(null)

// Native date text is laid out differently by iOS WebKit and can't be
// styled reliably across releases, so the native input stays for its picker
// only, with a stable app-owned label displayed above it.
function formatDateValue(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''

  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
}

const formattedValue = computed(() => formatDateValue(props.modelValue))

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function openPicker() {
  const input = inputEl.value
  if (!input) return

  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker()
      return
    } catch {
      // Some browsers throw if showPicker() isn't allowed here — fall through to focus().
    }
  }

  input.focus()
}
</script>
