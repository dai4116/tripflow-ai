<template>
  <span class="status-badge" :class="`status-badge--${tone}`">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent'
  }>(),
  {
    tone: 'default',
  },
)
</script>
