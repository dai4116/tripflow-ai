<template>
  <header class="page-header">
    <div>
      <RouterLink v-if="backTo" class="page-header__back" :to="backTo">
        ‹ {{ backLabel }}
      </RouterLink>
      <div class="page-header__title-row">
        <h1>{{ title }}</h1>
        <slot name="badge" />
      </div>
      <p v-if="description">{{ description }}</p>
    </div>

    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

withDefaults(
  defineProps<{
    title: string
    description?: string
    backTo?: RouteLocationRaw
    backLabel?: string
  }>(),
  {
    backLabel: 'Back',
  },
)
</script>
