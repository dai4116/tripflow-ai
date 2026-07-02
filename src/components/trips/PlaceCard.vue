<template>
  <BaseCard class="place-card">
    <div class="place-card__media" :style="{ background: place.imageGradient }" />
    <div class="place-card__content">
      <StatusBadge tone="default">{{ place.category }}</StatusBadge>
      <h3>{{ place.name }}</h3>
      <p>{{ place.reason }}</p>
      <div class="place-card__meta">
        <span>{{ place.estimatedTime }}h</span>
        <span>{{ place.rating }}</span>
        <span>{{ place.estimatedCost }}</span>
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import type { Place } from '../../types'
import BaseCard from '../ui/BaseCard.vue'
import StatusBadge from '../ui/StatusBadge.vue'

defineProps<{
  place: Place
}>()
</script>
