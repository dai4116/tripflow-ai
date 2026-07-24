<template>
  <aside class="app-sidebar">
    <RouterLink class="app-sidebar__brand" :to="{ name: 'landing' }">
      <span class="brand-mark"><AppIcon name="compass" :size="18" /></span>
      <span>TripFlow AI</span>
    </RouterLink>

    <RouterLink class="app-sidebar__cta" :to="{ name: 'trip-create' }">
      <AppIcon name="sparkle" />
      <span>AI 規劃行程</span>
    </RouterLink>

    <nav class="app-sidebar__section" aria-label="工作區導覽">
      <p class="app-sidebar__label">選單</p>
      <RouterLink :to="{ name: 'dashboard' }">
        <AppIcon name="home" />
        <span>首頁</span>
      </RouterLink>
      <RouterLink :to="{ name: 'trips' }">
        <AppIcon name="list" />
        <span>行程</span>
      </RouterLink>
    </nav>

    <div class="app-sidebar__user">
      <span class="app-sidebar__avatar">柏</span>
      <div>
        <strong>陳柏翰</strong>
        <small>bohan@tripflow.ai</small>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
</script>
