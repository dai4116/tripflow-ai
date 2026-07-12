<template>
  <header class="app-header">
    <RouterLink class="app-header__brand" :to="{ name: 'landing' }">
      <span class="brand-mark"><AppIcon name="compass" :size="16" /></span>
      <span>TripFlow AI</span>
    </RouterLink>

    <nav class="app-header__nav" aria-label="首頁導覽">
      <a href="#features">功能特色</a>
      <a href="#pricing">價格方案</a>
      <a href="#blog">部落格</a>
      <a href="#docs">使用說明</a>
    </nav>

    <nav class="app-header__actions" aria-label="帳號導覽">
      <RouterLink :to="{ name: 'dashboard' }">登入</RouterLink>
    </nav>
  </header>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
import BaseButton from '../ui/BaseButton.vue'
</script>
