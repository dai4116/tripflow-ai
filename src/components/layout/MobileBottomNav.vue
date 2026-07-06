<template>
  <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
    <RouterLink :to="{ name: 'dashboard' }">
      <AppIcon name="grid" :size="19" />
      <small>Home</small>
    </RouterLink>
    <RouterLink
      class="mobile-bottom-nav__primary"
      :to="{ name: 'trip-create' }"
      aria-label="Create new trip"
    >
      <AppIcon name="plus" :size="20" />
    </RouterLink>
    <RouterLink :to="{ name: 'trips' }">
      <AppIcon name="board" :size="19" />
      <small>Trips</small>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
</script>
