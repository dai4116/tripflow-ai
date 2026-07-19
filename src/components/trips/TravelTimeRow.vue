<template>
  <button type="button" class="travel-time-row" @click="emit('open')">
    <span class="travel-time-row__line" aria-hidden="true" />
    <template v-if="travel">
      <AppIcon :name="modeIcon" :size="13" />
      <span>{{ formatTravelDuration(travel.durationMin) }}</span>
      <span v-if="travel.distanceKm != null" class="travel-time-row__distance">
        · {{ travel.distanceKm.toFixed(1) }} 公里
      </span>
    </template>
    <template v-else>
      <span>自訂交通時間</span>
      <AppIcon class="travel-time-row__arrow" name="chevron-left" :size="11" />
    </template>
  </button>
</template>

<script setup lang="ts">
// Sits between two consecutive cards in the same day's column — nested
// inside the FROM card's own wrapper (see TripBoardPage.vue), not inserted
// as a new top-level sibling in the VueDraggable list, so it can't interfere
// with drag-reorder detection.
import { computed } from 'vue'
import { formatTravelDuration } from '../../data/routing'
import type { Place } from '../../types'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  place: Place
  nextPlace: Place
}>()

const emit = defineEmits<{ open: [] }>()

// travelToNext can point at a place that's no longer actually next (see the
// TravelToNext type comment) — the store re-fills it in the background, but
// until that resolves this falls back to the "not calculated yet" state
// rather than showing a stale pairing's numbers. Exposed as the object
// itself (not just a boolean) so the template can read off it directly
// instead of needing a non-null assertion vue-eslint-parser doesn't accept
// in template expressions.
const travel = computed(() => {
  const value = props.place.travelToNext
  return value?.toPlaceId === props.nextPlace.id ? value : null
})

const MODE_ICON = { driving: 'car', walking: 'walk', cycling: 'bike', manual: 'clock' } as const

const modeIcon = computed(() => MODE_ICON[travel.value?.mode ?? 'manual'])
</script>
