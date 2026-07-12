<template>
  <header class="mobile-top-bar">
    <RouterLink class="mobile-top-bar__brand" :to="{ name: 'dashboard' }">
      <span class="brand-mark"><AppIcon name="compass" :size="16" /></span>
      <strong>TripFlow AI</strong>
    </RouterLink>
    <span class="mobile-top-bar__avatar">柏</span>
  </header>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
</script>
