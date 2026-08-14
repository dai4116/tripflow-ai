<template>
  <section class="guest-landing">
    <div class="guest-landing__glow" aria-hidden="true" />

    <div class="guest-landing__brand">
      <span class="brand-mark"><AppIcon name="compass" :size="20" /></span>
      <strong>TripFlow AI</strong>
    </div>

    <h1 class="guest-landing__title">讓 AI 規劃你理想的旅程</h1>

    <BaseButton class="guest-landing__cta" :to="{ name: 'dashboard' }">
      立即開始
    </BaseButton>
    <p class="guest-landing__note">免費使用・免註冊</p>
  </section>
</template>

<script setup lang="ts">
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
</script>
