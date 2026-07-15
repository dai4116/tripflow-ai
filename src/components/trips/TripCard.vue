<template>
  <BaseCard class="trip-card">
    <div class="trip-card__media" :style="{ background: trip.imageGradient }">
      <button
        v-if="deletable"
        type="button"
        class="trip-card__delete"
        :aria-label="`刪除 ${trip.title}`"
        @click.stop.prevent="emit('delete')"
      >
        <AppIcon name="trash" :size="12" />
      </button>
      <div class="trip-card__title">
        <strong>{{ trip.title }}</strong>
        <small><AppIcon name="pin" :size="11" />{{ trip.destination }}</small>
        <small v-if="trip.dateRange"><AppIcon name="calendar" :size="11" />{{ trip.dateRange }}</small>
      </div>
    </div>

    <div class="trip-card__body">
      <div class="trip-card__meta">
        <span><AppIcon name="calendar" :size="12" />{{ trip.days }} 天</span>
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
  // dateRange is optional here (not part of TripSummary) because this card
  // also renders Explore templates, which aren't scheduled yet.
  trip: TripSummary & { dateRange?: string }
  deletable?: boolean
}>()

const emit = defineEmits<{
  delete: []
}>()
</script>
