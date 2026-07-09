<template>
  <BaseCard class="trip-card">
    <div class="trip-card__media" :style="{ background: trip.imageGradient }">
      <div class="trip-card__title">
        <strong>{{ trip.title }}</strong>
        <small><AppIcon name="pin" :size="11" />{{ trip.destination }}</small>
      </div>
    </div>

    <div class="trip-card__body">
      <div class="trip-card__meta">
        <span><AppIcon name="calendar" :size="12" />{{ trip.days }}d</span>
        <span><AppIcon name="users" :size="12" />{{ trip.travelers }}</span>
        <span><AppIcon name="pin" :size="12" />{{ trip.placeCount }}</span>
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import type { TripSummary } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseCard from '../ui/BaseCard.vue'

defineProps<{
  trip: TripSummary
}>()
</script>
