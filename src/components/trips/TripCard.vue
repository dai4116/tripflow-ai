<template>
  <BaseCard class="trip-card">
    <div class="trip-card__media" :style="{ background: trip.imageGradient }">
      <span class="trip-card__status" :class="`trip-card__status--${trip.status}`">
        {{ trip.status }}
      </span>
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

      <div class="trip-card__progress-label">
        <span>Progress</span>
        <strong :class="{ 'trip-card__progress-value--done': isDone }">{{ trip.progress }}%</strong>
      </div>

      <div
        class="trip-card__progress"
        :class="{ 'trip-card__progress--done': isDone }"
        aria-label="Trip planning progress"
      >
        <span :style="{ width: `${trip.progress}%` }" />
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TripSummary } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseCard from '../ui/BaseCard.vue'

const props = defineProps<{
  trip: TripSummary
}>()

const isDone = computed(() => props.trip.progress >= 100)
</script>
