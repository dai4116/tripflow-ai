<template>
  <article class="base-card" :class="{ 'base-card--soft': soft }">
    <slot />
  </article>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    soft?: boolean
  }>(),
  {
    soft: false,
  },
)
</script>
