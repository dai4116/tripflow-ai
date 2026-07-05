<template>
  <header class="mobile-top-bar">
    <RouterLink class="mobile-top-bar__brand" :to="{ name: 'dashboard' }">
      <span class="brand-mark">✈</span>
      <strong>{{ title }}</strong>
    </RouterLink>
    <span class="mobile-top-bar__avatar">AK</span>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>
