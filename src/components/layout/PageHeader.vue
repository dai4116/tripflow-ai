<template>
  <header class="page-header">
    <div>
      <RouterLink v-if="backTo" class="page-header__back" :to="backTo">
        <AppIcon name="chevron-left" :size="13" />
        {{ backLabel }}
      </RouterLink>
      <span v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</span>
      <div class="page-header__title-row">
        <h1>{{ title }}</h1>
        <slot name="badge" />
      </div>
      <p v-if="$slots.description || description">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>

    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import AppIcon from '../ui/AppIcon.vue'

withDefaults(
  defineProps<{
    title: string
    description?: string
    eyebrow?: string
    backTo?: RouteLocationRaw
    backLabel?: string
  }>(),
  {
    backLabel: '返回',
  },
)
</script>
