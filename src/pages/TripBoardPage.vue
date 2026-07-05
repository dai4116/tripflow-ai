<template>
  <section class="trip-board-page">
    <PageHeader
      :title="activeTrip.title"
      :description="tripHeaderDescription"
    >
      <template #badge>
        <StatusBadge tone="success">{{ activeTrip.status }}</StatusBadge>
      </template>
      <template #actions>
        <div class="trip-view-toggle" aria-label="Trip board view">
          <button
            type="button"
            :class="{ 'trip-view-toggle__button--active': mobileView === 'board' }"
            @click="mobileView = 'board'"
          >
            ▦ Board
          </button>
          <button
            type="button"
            :class="{ 'trip-view-toggle__button--active': mobileView === 'map' }"
            @click="mobileView = 'map'"
          >
            ▤ Map
          </button>
        </div>
        <template v-if="!isMobile">
          <BaseButton variant="secondary" size="sm">Filter</BaseButton>
          <BaseButton variant="secondary" size="sm">＋ Add place</BaseButton>
        </template>
      </template>
    </PageHeader>

    <div class="board-workspace">
      <div
        v-if="!isMobile || mobileView === 'board'"
        class="kanban-board"
        aria-label="Tokyo Explorer board"
      >
        <section
          v-for="column in activeTrip.columns"
          :key="column.id"
          class="kanban-column"
        >
          <header class="kanban-column__header">
            <span>{{ column.title }}</span>
            <span class="kanban-column__count">{{ column.placeIds.length }}</span>
          </header>

          <button
            v-for="place in getColumnPlaces(column.placeIds)"
            :key="place.id"
            class="place-card-button"
            :class="{ 'place-card-button--selected': selectedPlaceId === place.id }"
            type="button"
            @click="openPlaceDrawer(place.id)"
          >
            <PlaceCard :place="place" />
          </button>

          <button class="kanban-column__add" type="button">＋ Add place</button>
        </section>
      </div>

      <aside
        v-if="!isMobile || mobileView === 'map'"
        class="map-panel"
        aria-label="Static map preview"
      >
        <div class="map-panel__header">
          <strong>Map view</strong>
          <span>{{ places.length }} places</span>
        </div>
        <div class="map-panel__canvas">
          <button
            v-for="(place, index) in places"
            :key="place.id"
            class="map-dot"
            :class="[
              `map-dot--${place.category}`,
              { 'map-dot--selected': selectedPlaceId === place.id },
            ]"
            type="button"
            :style="markerPosition(index)"
            :title="place.name"
            :aria-label="`Open ${place.name} details`"
            @click="openPlaceDrawer(place.id)"
          />
        </div>
        <div class="map-panel__legend">
          <span><i class="legend-dot legend-dot--culture" />Culture</span>
          <span><i class="legend-dot legend-dot--food" />Food</span>
          <span><i class="legend-dot legend-dot--nature" />Nature</span>
          <span><i class="legend-dot legend-dot--shopping" />Shopping</span>
        </div>
      </aside>

      <Transition name="mobile-sheet-fade">
        <button
          v-if="drawerPlace && isMobile"
          class="mobile-sheet-overlay"
          type="button"
          aria-label="Close place details"
          @click="closeDrawer"
        />
      </Transition>

      <Transition :name="isMobile ? 'place-sheet-slide' : 'place-drawer-slide'">
        <aside
          v-if="drawerPlace"
          class="place-drawer"
          :class="{ 'place-drawer--sheet': isMobile }"
          aria-label="Place detail drawer"
        >
          <button class="place-drawer__close" type="button" aria-label="Close drawer" @click="closeDrawer">
            ×
          </button>
          <div class="place-drawer__image" :style="{ background: drawerPlace.imageGradient }">
            <h2>{{ drawerPlace.name }}</h2>
          </div>

          <div class="place-drawer__content">
            <div class="place-drawer__title-row">
              <StatusBadge tone="accent">{{ drawerPlace.category }}</StatusBadge>
              <strong>★ {{ drawerPlace.rating }} / 5.0</strong>
            </div>

            <p>{{ drawerPlace.reason }}</p>

            <div class="place-drawer__facts">
              <BaseCard>
                <span>Duration</span>
                <strong>{{ drawerPlace.estimatedTime }}h</strong>
              </BaseCard>
              <BaseCard>
                <span>Price</span>
                <strong>{{ drawerPlace.estimatedCost }}</strong>
              </BaseCard>
              <BaseCard>
                <span>Day</span>
                <strong>{{ getPlaceDay(drawerPlace.columnId) }}</strong>
              </BaseCard>
              <BaseCard>
                <span>Category</span>
                <strong>{{ drawerPlace.category }}</strong>
              </BaseCard>
            </div>

            <BaseButton>View on map</BaseButton>
            <BaseButton variant="secondary">Move to another day</BaseButton>
            <BaseButton variant="ghost">Remove place</BaseButton>
          </div>
        </aside>
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PageHeader from '../components/layout/PageHeader.vue'
import PlaceCard from '../components/trips/PlaceCard.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { places } from '../data/mockPlaces'
import { activeTrip } from '../data/mockTrips'

const isMobile = useIsMobile()
const mobileView = ref<'board' | 'map'>('board')
const selectedPlaceId = ref<string | null>(null)
const drawerPlaceId = ref<string | null>(null)

const tripHeaderDescription = computed(() => {
  if (isMobile.value) return `⌖ ${activeTrip.destination}`

  return `${activeTrip.destination} · ${activeTrip.dateRange} · ${activeTrip.travelers} travelers · ${activeTrip.budget} budget`
})
const drawerPlace = computed(() => places.find((place) => place.id === drawerPlaceId.value))
const shouldLockBodyScroll = computed(() => isMobile.value && Boolean(drawerPlace.value))

watch(
  shouldLockBodyScroll,
  (shouldLock) => {
    document.documentElement.classList.toggle('is-mobile-sheet-open', shouldLock)
    document.body.classList.toggle('is-mobile-sheet-open', shouldLock)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.documentElement.classList.remove('is-mobile-sheet-open')
  document.body.classList.remove('is-mobile-sheet-open')
})

function getColumnPlaces(placeIds: string[]) {
  return placeIds
    .map((placeId) => places.find((place) => place.id === placeId))
    .filter((place) => place !== undefined)
}

function openPlaceDrawer(placeId: string) {
  selectedPlaceId.value = placeId
  drawerPlaceId.value = placeId
}

function closeDrawer() {
  drawerPlaceId.value = null
}

function getPlaceDay(columnId: string) {
  const column = activeTrip.columns.find((item) => item.id === columnId)

  return column?.title ?? 'Planning'
}

function markerPosition(index: number) {
  const positions = [
    ['20%', '32%'],
    ['28%', '62%'],
    ['38%', '52%'],
    ['44%', '74%'],
    ['56%', '40%'],
    ['64%', '58%'],
    ['72%', '34%'],
    ['22%', '72%'],
    ['82%', '48%'],
    ['16%', '54%'],
    ['76%', '68%'],
    ['34%', '30%'],
  ]
  const [top, left] = positions[index] ?? ['50%', '50%']

  return { top, left }
}
</script>
