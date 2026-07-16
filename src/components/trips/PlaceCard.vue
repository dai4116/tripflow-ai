<template>
  <BaseCard
    class="place-card"
    :class="{
      'place-card--has-warning': hasTimeOverlap,
      'place-card--warning-open': overlapWarningOpen,
    }"
  >
    <button type="button" class="place-card__open" @click="emit('open')">
      <div class="place-card__media" :style="{ background: place.imageGradient }">
        <span class="place-card__index">{{ order }}</span>
      </div>
      <div class="place-card__content">
        <div class="place-card__top-row">
          <CategoryChip :category="place.category" icon-only />
          <span class="place-card__arrival">{{ arrivalTime }}</span>
        </div>
        <h3>{{ place.name }}</h3>
        <div class="place-card__meta">
          <span><AppIcon name="clock" :size="11" />{{ scheduleLabel }}</span>
        </div>
      </div>
    </button>

    <div v-if="hasTimeOverlap" class="place-card__warning">
      <button
        type="button"
        class="place-card__warning-trigger"
        aria-label="顯示時間衝突提醒"
        :aria-expanded="overlapWarningOpen"
        @click.stop="emit('toggleOverlapWarning')"
        @blur="emit('closeOverlapWarning')"
      >
        <AppIcon name="alert" :size="14" />
      </button>
      <span v-if="overlapWarningOpen" class="place-card__warning-tag" role="status">{{ warningMessage }}</span>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatStayDuration } from '../../data/placeSchedule'
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
  hasTimeOverlap?: boolean
  overlapWarningOpen?: boolean
  overlapReason?: 'arrival' | 'departure'
}>()

const emit = defineEmits<{
  open: []
  toggleOverlapWarning: []
  closeOverlapWarning: []
}>()

const warningMessage = computed(() =>
  props.overlapReason === 'departure' ? '離開時間有重疊喔！' : '抵達時間有重疊喔！',
)

const stayLabel = computed(() => formatStayDuration(props.place.estimatedTime))
const scheduleLabel = computed(() =>
  props.place.scheduleMode === 'departure' && props.place.departureTime
    ? `${props.place.departureTime}離開`
    : `停留 ${stayLabel.value}`,
)
</script>
