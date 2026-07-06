<template>
  <header class="app-header">
    <RouterLink class="app-header__brand" :to="{ name: 'landing' }">
      <span class="brand-mark"><AppIcon name="compass" :size="16" /></span>
      <span>TripFlow AI</span>
    </RouterLink>

    <nav class="app-header__nav" aria-label="Landing navigation">
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="#blog">Blog</a>
      <a href="#docs">Docs</a>
    </nav>

    <nav class="app-header__actions" aria-label="Account navigation">
      <RouterLink :to="{ name: 'dashboard' }">Sign in</RouterLink>
      <BaseButton :to="{ name: 'trip-create' }" size="sm">Get started</BaseButton>
    </nav>
  </header>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
import BaseButton from '../ui/BaseButton.vue'
</script>
