<template>
  <section class="trip-board-page">
    <PageHeader
      :title="activeTrip.title"
      :description="tripHeaderDescription"
    >
      <template #actions>
        <div class="trip-view-toggle" aria-label="Trip board view">
          <button
            type="button"
            :class="{ 'trip-view-toggle__button--active': mobileView === 'board' }"
            aria-label="Board view"
            @click="mobileView = 'board'"
          >
            <AppIcon name="list" :size="15" />
          </button>
          <button
            type="button"
            :class="{ 'trip-view-toggle__button--active': mobileView === 'map' }"
            aria-label="Map view"
            @click="mobileView = 'map'"
          >
            <AppIcon name="pin" :size="15" />
          </button>
        </div>
        <BaseButton v-if="!isMobile" variant="secondary" size="sm">
          <AppIcon name="filter" :size="13" />
          Filter
        </BaseButton>
        <BaseButton
          variant="accent"
          size="sm"
          class="page-header__add-place"
          @click="openAddPlaceModal(resolveDefaultColumnId(displayedColumns))"
        >
          <AppIcon name="plus" :size="13" />
          <span v-if="!isMobile">Add place</span>
        </BaseButton>
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
              <PlaceCard :place="place" />
            </button>
          </VueDraggable>
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
          <button
            v-if="!isEditingPlace"
            class="place-drawer__edit-toggle"
            type="button"
            aria-label="Edit place details"
            @click="startEdit"
          >
            <AppIcon name="edit" :size="13" />
          </button>
          <div class="place-drawer__image" :style="{ background: drawerPlace.imageGradient }">
            <h2>{{ drawerPlace.name }}</h2>
          </div>

          <div class="place-drawer__content">
            <template v-if="!isEditingPlace">
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
                <div class="place-drawer__move-wrap">
                  <BaseButton variant="secondary" @click="isMoveMenuOpen = !isMoveMenuOpen">Move day</BaseButton>
                  <div v-if="isMoveMenuOpen" class="place-drawer__move-menu" role="menu">
                    <button
                      v-for="column in displayedColumns"
                      :key="column.id"
                      type="button"
                      class="place-drawer__move-option"
                      role="menuitem"
                      :disabled="column.id === drawerPlace.columnId"
                      @click="moveDrawerPlaceTo(column.id)"
                    >
                      {{ column.title }}
                    </button>
                  </div>
                </div>
                <BaseButton class="place-drawer__remove" variant="ghost" @click="removeDrawerPlace">Remove place</BaseButton>
              </div>
              <button
                v-if="isMoveMenuOpen"
                class="place-drawer__move-backdrop"
                type="button"
                aria-label="Close move menu"
                @click="isMoveMenuOpen = false"
              />
            </template>

            <div v-else class="place-drawer__edit-form">
              <BaseInput v-model="editForm.name" label="Name" placeholder="Place name" />

              <div class="add-place-modal__pills">
                <button
                  v-for="category in allPlaceCategories"
                  :key="category"
                  type="button"
                  class="preference-chip"
                  :class="{ 'preference-chip--selected': editForm.category === category }"
                  @click="editForm.category = category"
                >
                  {{ categoryLabels[category] }}
                </button>
              </div>

              <div class="place-drawer__edit-row">
                <BaseInput v-model="editForm.estimatedTime" type="number" label="Duration (h)" :min="0" />
                <BaseInput v-model="editForm.estimatedCost" label="Price" placeholder="$$" />
              </div>

              <BaseInput v-model="editForm.description" label="Description" multiline :rows="3" />
              <BaseInput v-model="editForm.travelTip" label="Travel tip (optional)" placeholder="Optional tip" />

              <div class="place-drawer__edit-actions">
                <BaseButton variant="secondary" @click="cancelEdit">Cancel</BaseButton>
                <BaseButton :disabled="!editForm.name.trim()" @click="saveEdit">Save changes</BaseButton>
              </div>
            </div>
          </div>
        </aside>
      </Transition>

      <AddPlaceModal
        v-if="showAddModal"
        :columns="displayedColumns"
        :default-column-id="addModalColumnId"
        :city="cityName"
        :existing-names="tripPlaces.map((place) => place.name)"
        @close="showAddModal = false"
        @add="onAddPlace"
        @add-day="addDay"
        @remove-day="removeDay"
      />

      <AskAiPanel />
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import AddPlaceModal from '../components/trips/AddPlaceModal.vue'
import AskAiPanel from '../components/trips/AskAiPanel.vue'
import CategoryChip, { allPlaceCategories, categoryLabels } from '../components/trips/CategoryChip.vue'
import PlaceCard from '../components/trips/PlaceCard.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { useTripsStore } from '../stores/trips'
import type { Place, PlaceCategory, TripColumn } from '../types'

const route = useRoute()
const router = useRouter()
// Must match the CSS breakpoint where .board-workspace switches from a
// side-by-side grid to a single Board/Map pane (see global.scss) — below
// this width there's no room to show both, so the toggle takes over.
const isMobile = useIsMobile(1100)
const tripsStore = useTripsStore()
const { trips, places } = storeToRefs(tripsStore)
const mobileView = ref<'board' | 'map'>('board')
const selectedPlaceId = ref<string | null>(null)
const drawerPlaceId = ref<string | null>(null)
const isDraggingCard = ref(false)
const focusedColumnId = ref('')
const isFreshEntry = ref(route.query.fresh === '1')
const showSkeleton = ref(isFreshEntry.value)
const BOARD_SKELETON_DURATION = 650

const showAddModal = ref(false)
const addModalColumnId = ref('')
const isMoveMenuOpen = ref(false)
const isEditingPlace = ref(false)
const editForm = reactive({
  name: '',
  category: 'activity' as PlaceCategory,
  estimatedTime: '1.5',
  estimatedCost: '',
  description: '',
  travelTip: '',
})

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
  { id: 'day-1', title: 'Day 1', dayNumber: 1, placeIds: [] },
  { id: 'day-2', title: 'Day 2', dayNumber: 2, placeIds: [] },
  { id: 'day-3', title: 'Day 3', dayNumber: 3, placeIds: [] },
]

const activeTrip = computed(() => {
  const tripId = String(route.params.tripId ?? 'tokyo-explorer')

  return trips.value.find((trip) => trip.id === tripId) ?? trips.value[0]
})
const displayedColumns = computed(() => (activeTrip.value.columns.length > 0 ? activeTrip.value.columns : emptyColumns))
const tripPlaces = computed(() => places.value.filter((place) => place.tripId === activeTrip.value.id))

function resolveDefaultColumnId(columns: TripColumn[]) {
  const firstWithPlaces = columns.find((column) => column.placeIds.length > 0)

  return firstWithPlaces?.id ?? columns[0]?.id ?? ''
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
const cityName = computed(() => activeTrip.value.destination.split(',')[0].trim() || activeTrip.value.destination)

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
    isMoveMenuOpen.value = false
    isEditingPlace.value = false
    showAddModal.value = false
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
  return dayColumnColors[(column.dayNumber - 1) % dayColumnColors.length]
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
  tripsStore.recalcPlaceCount(activeTrip.value)
  isDraggingCard.value = false
}

function openPlaceDrawer(placeId: string) {
  selectedPlaceId.value = placeId
  drawerPlaceId.value = placeId
  isMoveMenuOpen.value = false
  isEditingPlace.value = false

  const place = tripPlaces.value.find((item) => item.id === placeId)
  if (place) focusedColumnId.value = place.columnId
}

function closeDrawer() {
  drawerPlaceId.value = null
  isMoveMenuOpen.value = false
  isEditingPlace.value = false
}

function openAddPlaceModal(columnId: string) {
  addModalColumnId.value = columnId || displayedColumns.value[0]?.id || ''
  showAddModal.value = true
}

function onAddPlace(payload: { columnId: string; name: string; category: PlaceCategory; description: string }) {
  tripsStore.addPlace({ tripId: activeTrip.value.id, ...payload })
}

// Trips with no real columns yet render the emptyColumns fallback (see
// displayedColumns) — build on top of whatever is currently shown so adding
// or removing a day never silently drops the fallback's other days.
function addDay() {
  const nextDayNumber = displayedColumns.value.length + 1
  // nanoid rather than `day-${nextDayNumber}` — after a mid-list day is
  // removed and the rest renumbered, a position-based id could collide with
  // a survivor that kept its original id.
  activeTrip.value.columns = [
    ...displayedColumns.value,
    { id: `day-${nanoid(6)}`, dayNumber: nextDayNumber, title: `Day ${nextDayNumber}`, placeIds: [] },
  ]
  activeTrip.value.days = activeTrip.value.columns.length
}

// Deletes the day itself and every place on it (not a move — the confirm
// prompt in AddPlaceModal is explicit that this is destructive), then
// renumbers the remaining days so they stay sequential.
function removeDay(columnId: string) {
  const current = displayedColumns.value
  const column = current.find((item) => item.id === columnId)
  if (!column || current.length <= 1) return

  const placeIdsToRemove = new Set(column.placeIds)
  places.value = places.value.filter((place) => !placeIdsToRemove.has(place.id))

  activeTrip.value.columns = current
    .filter((item) => item.id !== columnId)
    .map((item, index) => ({ ...item, dayNumber: index + 1, title: `Day ${index + 1}` }))
  activeTrip.value.days = activeTrip.value.columns.length

  if (drawerPlaceId.value && placeIdsToRemove.has(drawerPlaceId.value)) closeDrawer()
  if (focusedColumnId.value === columnId) focusedColumnId.value = resolveDefaultColumnId(displayedColumns.value)
}

function removeDrawerPlace() {
  if (!drawerPlace.value) return
  if (!window.confirm(`Remove "${drawerPlace.value.name}" from this trip?`)) return

  tripsStore.removePlace(drawerPlace.value.id)
  closeDrawer()
}

function moveDrawerPlaceTo(columnId: string) {
  if (!drawerPlace.value) return

  tripsStore.movePlaceToColumn(drawerPlace.value.id, columnId)
  focusedColumnId.value = columnId
  isMoveMenuOpen.value = false
}

function startEdit() {
  if (!drawerPlace.value) return

  editForm.name = drawerPlace.value.name
  editForm.category = drawerPlace.value.category
  editForm.estimatedTime = String(drawerPlace.value.estimatedTime)
  editForm.estimatedCost = drawerPlace.value.estimatedCost
  editForm.description = drawerPlace.value.description
  editForm.travelTip = drawerPlace.value.travelTip ?? ''
  isEditingPlace.value = true
}

function cancelEdit() {
  isEditingPlace.value = false
}

function saveEdit() {
  if (!drawerPlace.value || !editForm.name.trim()) return

  tripsStore.updatePlace(drawerPlace.value.id, {
    name: editForm.name.trim(),
    category: editForm.category,
    estimatedTime: Number(editForm.estimatedTime) || drawerPlace.value.estimatedTime,
    estimatedCost: editForm.estimatedCost.trim() || drawerPlace.value.estimatedCost,
    description: editForm.description.trim() || drawerPlace.value.description,
    travelTip: editForm.travelTip.trim() || undefined,
  })
  isEditingPlace.value = false
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
