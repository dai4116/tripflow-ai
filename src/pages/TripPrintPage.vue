<template>
  <div v-if="activeTrip" class="trip-print-page">
    <header class="trip-print-page__toolbar">
      <RouterLink :to="{ name: 'trip-board', params: { tripId: activeTrip.id } }" class="trip-print-page__back">
        <AppIcon name="chevron-left" :size="14" />
        返回行程
      </RouterLink>
      <button type="button" class="trip-print-page__export" @click="printPage">
        <AppIcon name="printer" :size="15" />
        列印 / 匯出 PDF
      </button>
    </header>

    <div class="trip-print-page__sheet">
      <div class="trip-print-page__running" aria-hidden="true">{{ activeTrip.title }}</div>

      <div class="trip-print-page__head">
        <h1>{{ activeTrip.title }}</h1>
        <p>
          {{ activeTrip.destination }} ·
          <span :class="{ 'trip-print-page__unscheduled': !activeTrip.startDate }">{{ activeTrip.dateRange }}</span>
          · 共 {{ displayedColumns.length }} 天
        </p>
      </div>

      <p v-if="displayedColumns.length === 0" class="trip-print-page__empty">
        這趟旅程還沒有安排天數,回行程看板加一些地點吧。
      </p>

      <section v-for="day in dayViews" :key="day.column.id" class="trip-print-page__day">
        <header class="trip-print-page__day-head">
          <span class="trip-print-page__day-badge">{{ day.column.dayNumber }}</span>
          <span>
            {{ day.column.title }}<template v-if="day.dateLabel"> · {{ day.dateLabel }}</template> ·
            {{ day.column.placeIds.length }} 個地點
          </span>
        </header>

        <p v-if="day.entries.length === 0" class="trip-print-page__empty">這天還沒有安排地點。</p>

        <ol v-else class="trip-print-page__stops">
          <template v-for="entry in day.entries" :key="entry.card.place.id">
            <li class="trip-print-page__stop">
              <span class="trip-print-page__time">{{ entry.card.arrivalTime }}</span>
              <span class="trip-print-page__stop-body">
                <span class="trip-print-page__stop-name">{{ entry.card.place.name }}</span>
                <CategoryChip :category="entry.card.place.category" />
              </span>
              <span class="trip-print-page__duration">停留 {{ formatStayDuration(entry.card.place.estimatedTime) }}</span>
            </li>
            <li v-if="entry.travel" class="trip-print-page__connector">
              <AppIcon :name="TRAVEL_MODE_ICON[entry.travel.mode]" :size="12" />
              {{ formatTravelDuration(entry.travel.durationMin) }}
            </li>
          </template>
        </ol>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CategoryChip from '../components/trips/CategoryChip.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import { useColumnSchedule } from '../composables/useColumnSchedule'
import { dayWindowForPace, formatColumnDate } from '../data/generateTrip'
import { formatStayDuration } from '../data/placeSchedule'
import { formatTravelDuration, TRAVEL_MODE_ICON } from '../data/routing'
import { useTripsStore } from '../stores/trips'
import type { TripColumn } from '../types'

const route = useRoute()
const router = useRouter()
const tripsStore = useTripsStore()
const { trips, places } = storeToRefs(tripsStore)

const activeTrip = computed(() => trips.value.find((trip) => trip.id === String(route.params.tripId)))

// Same same-tick-empty-store race trip-board guards against (see its own
// watch comment) — trips is a cross-tab-synced useStorage ref, so the last
// trip can disappear out from under an already-mounted page with no
// navigation involved.
watch(
  activeTrip,
  (trip) => {
    if (!trip) router.replace({ name: 'dashboard' })
  },
  { immediate: true },
)

const displayedColumns = computed(() => activeTrip.value?.columns ?? [])
const tripPlaces = computed(() => places.value.filter((place) => place.tripId === activeTrip.value?.id))
const dayStartTime = computed(() => dayWindowForPace(activeTrip.value?.pace ?? 'balanced').start)
const { getColumnCards } = useColumnSchedule(
  () => tripPlaces.value,
  () => displayedColumns.value,
  () => dayStartTime.value,
)

function columnDate(column: TripColumn): string {
  return formatColumnDate(activeTrip.value?.startDate, column.dayNumber)
}

// Bundles each card with the (possibly stale — see TravelToNext's type
// comment) travel leg to whichever place is actually next in this list, so
// the template never renders a travel time that no longer matches its
// neighbor after a reorder.
const dayViews = computed(() =>
  displayedColumns.value.map((column) => {
    const cards = getColumnCards(column.placeIds)
    return {
      column,
      dateLabel: columnDate(column),
      entries: cards.map((card, index) => {
        const nextPlace = cards[index + 1]?.place
        const travel = card.place.travelToNext
        return {
          card,
          travel: travel && nextPlace && travel.toPlaceId === nextPlace.id ? travel : null,
        }
      }),
    }
  }),
)

function printPage() {
  window.print()
}
</script>
