<template>
  <BaseCard class="place-card">
    <div class="place-card__media" :style="{ background: place.imageGradient }">
      <span class="place-card__index">{{ order }}</span>
    </div>
    <div class="place-card__content">
      <div class="place-card__top-row">
        <CategoryChip :category="place.category" icon-only />
        <span class="place-card__arrival" :class="{ 'place-card__arrival--manual': arrivalTimeIsManual }">{{ arrivalTime }}</span>
      </div>
      <h3>{{ place.name }}</h3>
      <div class="place-card__meta">
        <span><AppIcon name="clock" :size="11" />停留 {{ stayLabel }}</span>
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Place } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseCard from '../ui/BaseCard.vue'
import CategoryChip from './CategoryChip.vue'

const props = defineProps<{
  place: Place
  // 1-based position within its day column — same ordering the map's pins
  // number themselves with, so a card and its pin always show the same digit.
  order: number
  // Resolved by the parent from the whole day's cascade (see
  // computeArrivalTimes in data/placeSchedule.ts) — this component only
  // renders whatever effective time it's given.
  arrivalTime: string
  arrivalTimeIsManual: boolean
}>()

// estimatedTime is stored as a decimal (e.g. 1.5) — once there's a
// fractional part, render "N 時 M 分" instead of "1.5 小時".
const stayLabel = computed(() => {
  const hours = Math.floor(props.place.estimatedTime)
  const minutes = Math.round((props.place.estimatedTime - hours) * 60)

  return minutes > 0 ? `${hours} 時 ${String(minutes).padStart(2, '0')} 分` : `${hours} 小時`
})
</script>
