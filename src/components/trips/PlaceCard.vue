<template>
  <BaseCard class="place-card">
    <div class="place-card__media" :style="{ background: place.imageGradient }" />
    <div class="place-card__content">
      <CategoryChip :category="place.category" />
      <h3>{{ place.name }}</h3>
      <div class="place-card__meta">
        <span><AppIcon name="clock" :size="11" />{{ place.estimatedTime }}h</span>
        <span class="place-card__rating"><AppIcon name="star" :size="11" />{{ place.rating }}</span>
        <span>{{ place.estimatedCost }}</span>
      </div>
      <span v-if="completed" class="place-card__done">
        <AppIcon name="check" :size="12" />Completed
      </span>
      <p v-else-if="place.travelTip" class="place-card__tip">{{ place.travelTip }}</p>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import type { Place } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseCard from '../ui/BaseCard.vue'
import CategoryChip from './CategoryChip.vue'

withDefaults(
  defineProps<{
    place: Place
    completed?: boolean
  }>(),
  {
    completed: false,
  },
)
</script>
