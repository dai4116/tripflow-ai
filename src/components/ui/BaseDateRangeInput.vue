<template>
  <div class="base-field date-range-field" :class="{ 'base-field--error': error }">
    <span v-if="label">{{ label }}</span>

    <div class="date-range-field__row">
      <div class="base-field__control date-range-field__control" @click="openPicker(startInputEl)">
        <AppIcon name="calendar" :size="15" />
        <input ref="startInputEl" type="date" :min="min" :value="start" @input="onStartInput" />
      </div>
      <AppIcon name="arrow-right" :size="13" class="date-range-field__arrow" />
      <div class="base-field__control date-range-field__control" @click="openPicker(endInputEl)">
        <AppIcon name="calendar" :size="15" />
        <input ref="endInputEl" type="date" :min="start || min" :value="end" @input="onEndInput" />
      </div>
    </div>

    <small v-if="error" class="base-field__error">{{ error }}</small>
    <small v-else-if="summary" class="date-range-field__summary">{{ summary }}</small>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  label?: string
  start?: string
  end?: string
  min?: string
  error?: string
}>()

const emit = defineEmits<{
  'update:start': [value: string]
  'update:end': [value: string]
}>()

const startInputEl = ref<HTMLInputElement | null>(null)
const endInputEl = ref<HTMLInputElement | null>(null)

function onStartInput(event: Event) {
  emit('update:start', (event.target as HTMLInputElement).value)
}

function onEndInput(event: Event) {
  emit('update:end', (event.target as HTMLInputElement).value)
}

// The native picker-indicator icon is hidden (see CSS) so there's only one
// calendar glyph per box — clicking anywhere in the box has to open the
// picker itself, not just focus the input, or there'd be no way to open it.
function openPicker(input: HTMLInputElement | null) {
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

// Both dates must parse and land in order for a range to mean anything —
// a half-picked or reversed range just shows no summary rather than a
// nonsense one (e.g. "-3 nights").
const summary = computed(() => {
  if (!props.start || !props.end) return ''

  const startDate = new Date(props.start)
  const endDate = new Date(props.end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return ''

  const nights = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  if (nights <= 0) return ''

  const format = (date: Date) => date.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })

  return `${format(startDate)} – ${format(endDate)} · ${nights} 晚`
})
</script>
