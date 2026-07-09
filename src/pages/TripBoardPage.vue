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
            Board
          </button>
          <button
            type="button"
            :class="{ 'trip-view-toggle__button--active': mobileView === 'map' }"
            @click="mobileView = 'map'"
          >
            Map
          </button>
        </div>
        <template v-if="!isMobile">
          <BaseButton variant="secondary" size="sm">
            <AppIcon name="filter" :size="13" />
            Filter
          </BaseButton>
          <BaseButton size="sm">
            <AppIcon name="plus" :size="13" />
            Add place
          </BaseButton>
        </template>
      </template>
    </PageHeader>

    <Transition name="board-reveal" mode="out-in">
      <div
        v-if="showSkeleton"
        key="skeleton"
        class="kanban-skeleton"
        role="status"
        aria-label="Generating your itinerary board"
      >
        <div v-for="column in displayedColumns" :key="column.id" class="kanban-skeleton__column">
          <div class="kanban-skeleton__header" />
          <div v-for="n in Math.max(column.placeIds.length, 1)" :key="n" class="kanban-skeleton__card" />
        </div>
      </div>

      <div v-else key="board" class="board-workspace">
      <div
        v-if="!isMobile || mobileView === 'board'"
        class="kanban-board"
        :class="{ 'kanban-board--dragging': isDraggingCard, 'kanban-board--fresh-enter': isFreshEntry }"
        :aria-label="`${activeTrip.title} board`"
      >
        <section
          v-for="column in displayedColumns"
          :key="column.id"
          class="kanban-column"
        >
          <header class="kanban-column__header">
            <button
              type="button"
              class="kanban-column__focus"
              :class="{ 'kanban-column__focus--active': focusedColumnId === column.id }"
              :aria-pressed="focusedColumnId === column.id"
              :aria-label="`Show ${column.title} on the map`"
              @click="focusColumn(column.id)"
            >
              <span class="kanban-column__dot" :style="{ backgroundColor: columnColor(column) }" />
              <span class="kanban-column__title">{{ column.title }}</span>
              <span class="kanban-column__count">{{ column.placeIds.length }}</span>
            </button>
            <button
              class="kanban-column__quick-add"
              type="button"
              :aria-label="`Add place to ${column.title}`"
            >
              <AppIcon name="plus" :size="13" />
            </button>
          </header>

          <VueDraggable
            v-model="column.placeIds"
            class="kanban-column__cards"
            group="kanban-places"
            :animation="150"
            :delay="150"
            :delay-on-touch-only="true"
            :scroll-sensitivity="80"
            :scroll-speed="16"
            :bubble-scroll="true"
            ghost-class="place-card-button--ghost"
            chosen-class="place-card-button--chosen"
            drag-class="place-card-button--dragging"
            @start="isDraggingCard = true"
            @end="onDragEnd"
          >
            <button
              v-for="place in getColumnPlaces(column.placeIds)"
              :key="place.id"
              class="place-card-button"
              :class="{ 'place-card-button--selected': selectedPlaceId === place.id }"
              type="button"
              @click="openPlaceDrawer(place.id)"
            >
              <PlaceCard :place="place" :completed="column.type === 'done'" />
            </button>
          </VueDraggable>

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
          <span>{{ tripPlaces.length }} places</span>
        </div>
        <div class="map-panel__canvas">
          <svg class="map-panel__route" viewBox="0 0 340 560" preserveAspectRatio="none" aria-hidden="true">
            <path v-if="routePathD" :d="routePathD" />
          </svg>
          <button
            v-for="(place, index) in tripPlaces"
            :key="place.id"
            class="map-pin"
            :class="[
              `map-pin--${place.category}`,
              {
                'map-pin--selected': selectedPlaceId === place.id,
                'map-pin--dim': hasFocusHighlight && !isPlaceFocused(place.id),
              },
            ]"
            type="button"
            :style="markerPosition(index)"
            :title="place.name"
            :aria-label="`Open ${place.name} details`"
            @click="openPlaceDrawer(place.id)"
          >
            <AppIcon name="pin-solid" :size="24" />
            <span v-if="focusOrder(place.id)" class="map-pin__order">{{ focusOrder(place.id) }}</span>
          </button>
          <span class="map-panel__coord">{{ activeTrip.destination.toUpperCase() }}</span>
        </div>
        <div class="map-panel__legend">
          <span v-for="category in legendCategories" :key="category.key">
            <i class="legend-dot" :class="`legend-dot--${category.key}`" />{{ category.label }}
          </span>
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
            <AppIcon name="close" :size="13" />
          </button>
          <div class="place-drawer__image" :style="{ background: drawerPlace.imageGradient }">
            <h2>{{ drawerPlace.name }}</h2>
          </div>

          <div class="place-drawer__content">
            <div class="place-drawer__title-row">
              <CategoryChip :category="drawerPlace.category" />
              <strong class="place-drawer__rating">
                <AppIcon name="star" :size="12" />
                {{ drawerPlace.rating }} <span>/ 5.0</span>
              </strong>
            </div>

            <p class="place-drawer__description">{{ drawerPlace.description }}</p>

            <div class="place-drawer__facts">
              <div class="place-drawer__fact">
                <span>Duration</span>
                <strong>{{ drawerPlace.estimatedTime }}h</strong>
              </div>
              <div class="place-drawer__fact">
                <span>Price</span>
                <strong>{{ drawerPlace.estimatedCost }}</strong>
              </div>
              <div class="place-drawer__fact">
                <span>Day</span>
                <strong>{{ getPlaceDay(drawerPlace.columnId) }}</strong>
              </div>
              <div class="place-drawer__fact">
                <span>Category</span>
                <strong>{{ drawerPlace.category }}</strong>
              </div>
            </div>

            <div v-if="drawerPlace.travelTip" class="place-drawer__tip">
              <AppIcon name="sparkle" :size="15" />
              <div>
                <b>Travel tip</b>
                {{ drawerPlace.travelTip }}
              </div>
            </div>

            <div class="place-drawer__actions">
              <BaseButton @click="viewOnMap">View on map</BaseButton>
              <BaseButton variant="secondary">Move day</BaseButton>
              <BaseButton class="place-drawer__remove" variant="ghost">Remove place</BaseButton>
            </div>
          </div>
        </aside>
      </Transition>

      <AskAiPanel />
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import AskAiPanel from '../components/trips/AskAiPanel.vue'
import CategoryChip from '../components/trips/CategoryChip.vue'
import PlaceCard from '../components/trips/PlaceCard.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { useTripsStore } from '../stores/trips'
import type { Place, TripColumn } from '../types'

const route = useRoute()
const router = useRouter()
// Must match the CSS breakpoint where .board-workspace switches from a
// side-by-side grid to a single Board/Map pane (see global.scss) — below
// this width there's no room to show both, so the toggle takes over.
const isMobile = useIsMobile(1100)
const { trips, places } = storeToRefs(useTripsStore())
const mobileView = ref<'board' | 'map'>('board')
const selectedPlaceId = ref<string | null>(null)
const drawerPlaceId = ref<string | null>(null)
const isDraggingCard = ref(false)
const focusedColumnId = ref('')
const isFreshEntry = ref(route.query.fresh === '1')
const showSkeleton = ref(isFreshEntry.value)
const BOARD_SKELETON_DURATION = 650

const legendCategories = [
  { key: 'culture', label: 'Culture' },
  { key: 'food', label: 'Food' },
  { key: 'nature', label: 'Nature' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'activity', label: 'Activity' },
  { key: 'transport', label: 'Transport' },
  { key: 'stay', label: 'Stay' },
]

const dayColumnColors = ['#2e9e62', '#4a7de0', '#ef7a3a']
const emptyColumns: TripColumn[] = [
  { id: 'planning', title: 'Planning', type: 'planning', placeIds: [] },
  { id: 'day-1', title: 'Day 1', type: 'day', dayNumber: 1, placeIds: [] },
  { id: 'day-2', title: 'Day 2', type: 'day', dayNumber: 2, placeIds: [] },
  { id: 'day-3', title: 'Day 3', type: 'day', dayNumber: 3, placeIds: [] },
  { id: 'done', title: 'Done', type: 'done', placeIds: [] },
]

const activeTrip = computed(() => {
  const tripId = String(route.params.tripId ?? 'tokyo-explorer')

  return trips.value.find((trip) => trip.id === tripId) ?? trips.value[0]
})
const displayedColumns = computed(() => (activeTrip.value.columns.length > 0 ? activeTrip.value.columns : emptyColumns))
const tripPlaces = computed(() => places.value.filter((place) => place.tripId === activeTrip.value.id))

function resolveDefaultColumnId(columns: TripColumn[]) {
  const firstDayWithPlaces = columns.find((column) => column.type === 'day' && column.placeIds.length > 0)
  const firstWithPlaces = columns.find((column) => column.placeIds.length > 0)

  return firstDayWithPlaces?.id ?? firstWithPlaces?.id ?? columns[0]?.id ?? ''
}

focusedColumnId.value = resolveDefaultColumnId(displayedColumns.value)

const focusedPlaces = computed(() => {
  const column = displayedColumns.value.find((item) => item.id === focusedColumnId.value)
  if (!column) return []

  return column.placeIds
    .map((placeId) => tripPlaces.value.find((place) => place.id === placeId))
    .filter((place): place is Place => place !== undefined)
})
const hasFocusHighlight = computed(() => focusedPlaces.value.length > 0)

const ROUTE_VIEWBOX = { width: 340, height: 560 }
const routePathD = computed(() => {
  const points = focusedPlaces.value.map((place) => {
    const index = tripPlaces.value.findIndex((item) => item.id === place.id)
    const position = markerPosition(index)

    return {
      x: (Number.parseFloat(position.left) / 100) * ROUTE_VIEWBOX.width,
      y: (Number.parseFloat(position.top) / 100) * ROUTE_VIEWBOX.height,
    }
  })

  if (points.length < 2) return ''

  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
})

const tripHeaderDescription = computed(() => {
  if (isMobile.value) return activeTrip.value.destination

  return `${activeTrip.value.destination} · ${activeTrip.value.dateRange} · ${activeTrip.value.travelers} travelers · ${activeTrip.value.budget} budget`
})
const drawerPlace = computed(() => tripPlaces.value.find((place) => place.id === drawerPlaceId.value))
const shouldLockBodyScroll = computed(() => isMobile.value && Boolean(drawerPlace.value))

watch(
  shouldLockBodyScroll,
  (shouldLock) => {
    document.documentElement.classList.toggle('is-mobile-sheet-open', shouldLock)
    document.body.classList.toggle('is-mobile-sheet-open', shouldLock)
  },
  { immediate: true },
)

watch(
  () => route.params.tripId,
  () => {
    selectedPlaceId.value = null
    drawerPlaceId.value = null
    focusedColumnId.value = resolveDefaultColumnId(displayedColumns.value)
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)

  if (isFreshEntry.value) {
    window.setTimeout(() => {
      showSkeleton.value = false
      router.replace({ path: route.path })
    }, BOARD_SKELETON_DURATION)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.documentElement.classList.remove('is-mobile-sheet-open')
  document.body.classList.remove('is-mobile-sheet-open')
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDrawer()
}

function columnColor(column: TripColumn) {
  if (column.type === 'planning') return '#8161e6'
  if (column.type === 'done') return '#2e9e62'

  return dayColumnColors[((column.dayNumber ?? 1) - 1) % dayColumnColors.length]
}

function getColumnPlaces(placeIds: string[]) {
  return placeIds
    .map((placeId) => tripPlaces.value.find((place) => place.id === placeId))
    .filter((place) => place !== undefined)
}

function syncPlaceColumns() {
  for (const column of displayedColumns.value) {
    for (const placeId of column.placeIds) {
      const place = places.value.find((item) => item.id === placeId)
      if (place) place.columnId = column.id
    }
  }
}

function onDragEnd() {
  syncPlaceColumns()
  isDraggingCard.value = false
}

function openPlaceDrawer(placeId: string) {
  selectedPlaceId.value = placeId
  drawerPlaceId.value = placeId

  const place = tripPlaces.value.find((item) => item.id === placeId)
  if (place) focusedColumnId.value = place.columnId
}

function closeDrawer() {
  drawerPlaceId.value = null
}

function focusColumn(columnId: string) {
  focusedColumnId.value = columnId
}

function isPlaceFocused(placeId: string) {
  return focusedPlaces.value.some((place) => place.id === placeId)
}

function focusOrder(placeId: string): number | null {
  const index = focusedPlaces.value.findIndex((place) => place.id === placeId)

  return index === -1 ? null : index + 1
}

function viewOnMap() {
  if (isMobile.value) mobileView.value = 'map'
  closeDrawer()
}

function getPlaceDay(columnId: string) {
  const column = displayedColumns.value.find((item) => item.id === columnId)

  return column?.title ?? 'Planning'
}

const CURATED_MARKER_POSITIONS = [
  ['25%', '28%'],
  ['64%', '36%'],
  ['41%', '63%'],
  ['22%', '70%'],
  ['35%', '31%'],
  ['57%', '24%'],
  ['50%', '30%'],
  ['44%', '44%'],
  ['31%', '58%'],
  ['76%', '66%'],
  ['52%', '41%'],
  ['68%', '52%'],
]

// AI-generated trips can have more places than the curated table above —
// spiral the overflow out at the golden angle so pins stay spread out and
// in-bounds instead of collapsing onto a single fallback point.
function overflowMarkerPosition(index: number) {
  const goldenAngleRad = (137.508 * Math.PI) / 180
  const angle = index * goldenAngleRad
  const radius = 12 + (index % 7) * 6
  const clamp = (value: number) => Math.min(84, Math.max(10, value))

  return {
    top: `${clamp(46 + radius * Math.sin(angle) * 0.9).toFixed(1)}%`,
    left: `${clamp(46 + radius * Math.cos(angle)).toFixed(1)}%`,
  }
}

function markerPosition(index: number) {
  const curated = CURATED_MARKER_POSITIONS[index]
  if (curated) {
    const [top, left] = curated

    return { top, left }
  }

  return overflowMarkerPosition(index)
}
</script>
