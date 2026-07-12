<template>
  <BaseCard class="place-card">
    <div class="place-card__media" :style="{ background: place.imageGradient }" />
    <div class="place-card__content">
      <CategoryChip :category="place.category" />
      <h3>{{ place.name }}</h3>
      <div class="place-card__meta">
        <span><AppIcon name="clock" :size="11" />{{ place.estimatedTime }} 小時</span>
        <span class="place-card__rating"><AppIcon name="star" :size="11" />{{ place.rating }}</span>
        <span>{{ place.estimatedCost }}</span>
      </div>
      <p v-if="place.travelTip" class="place-card__tip">{{ place.travelTip }}</p>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import type { Place } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseCard from '../ui/BaseCard.vue'
import CategoryChip from './CategoryChip.vue'

defineProps<{
  place: Place
}>()
</script>
