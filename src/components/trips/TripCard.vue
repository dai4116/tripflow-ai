<template>
  <BaseCard class="trip-card">
    <div class="trip-card__media" :style="{ background: trip.imageGradient }">
      <StatusBadge :tone="trip.status === 'active' ? 'success' : trip.status === 'done' ? 'accent' : 'default'">
        {{ trip.status }}
      </StatusBadge>
    </div>

    <div class="trip-card__body">
      <h3>{{ trip.title }}</h3>
      <p class="trip-card__location">⌖ {{ trip.destination }}</p>

      <div class="trip-card__meta">
        <span>▣ {{ trip.days }}d</span>
        <span>♙ {{ trip.travelers }}</span>
        <span>⌖ {{ trip.placeCount }}</span>
      </div>

      <div class="trip-card__progress-label">
        <span>Progress</span>
        <strong>{{ trip.progress }}%</strong>
      </div>

      <div class="trip-card__progress" aria-label="Trip planning progress">
        <span :style="{ width: `${trip.progress}%` }" />
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import type { TripSummary } from '../../types'
import BaseCard from '../ui/BaseCard.vue'
import StatusBadge from '../ui/StatusBadge.vue'

defineProps<{
  trip: TripSummary
}>()
</script>
