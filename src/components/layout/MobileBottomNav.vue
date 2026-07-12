<template>
  <nav class="mobile-bottom-nav" aria-label="手機版導覽">
    <RouterLink :to="{ name: 'dashboard' }">
      <AppIcon name="grid" :size="19" />
      <small>首頁</small>
    </RouterLink>
    <RouterLink
      class="mobile-bottom-nav__primary"
      :to="{ name: 'trip-create' }"
      aria-label="用 AI 建立新行程"
    >
      <AppIcon name="sparkle" :size="19" />
    </RouterLink>
    <RouterLink :to="{ name: 'trips' }">
      <AppIcon name="list" :size="19" />
      <small>行程</small>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
</script>
