<template>
  <header class="app-header">
    <RouterLink class="app-header__brand" :to="{ name: 'landing' }">
      <span class="brand-mark"><AppIcon name="compass" :size="16" /></span>
      <span>TripFlow AI</span>
    </RouterLink>

    <nav class="app-header__actions" aria-label="帳號導覽">
      <RouterLink :to="{ name: 'dashboard' }">登入</RouterLink>
    </nav>
  </header>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
</script>
