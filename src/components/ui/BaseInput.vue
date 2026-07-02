<template>
  <label class="base-field">
    <span v-if="label">{{ label }}</span>
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
      @input="emitValue"
    />
  </label>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    modelValue?: string | number
    placeholder?: string
    type?: string
    multiline?: boolean
    rows?: number
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
