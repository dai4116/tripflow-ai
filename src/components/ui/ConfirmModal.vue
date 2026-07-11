<template>
  <Teleport to="body">
    <div class="confirm-modal-overlay" role="presentation" @click.self="emit('cancel')">
      <section class="confirm-modal" role="alertdialog" aria-modal="true" :aria-label="title">
        <h3 class="confirm-modal__title">{{ title }}</h3>
        <p class="confirm-modal__message">{{ message }}</p>
        <div class="confirm-modal__actions">
          <BaseButton variant="secondary" @click="emit('cancel')">{{ cancelLabel }}</BaseButton>
          <BaseButton :variant="danger ? 'danger' : 'primary'" @click="emit('confirm')">{{ confirmLabel }}</BaseButton>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import BaseButton from './BaseButton.vue'

withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
