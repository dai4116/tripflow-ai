<template>
  <section class="trip-board-page trip-board-page--explore">
    <PageHeader :title="template.title" :description="headerDescription">
      <template #actions>
        <div class="trip-view-toggle" aria-label="行程看板檢視">
          <button
            type="button"
            :class="{ 'trip-view-toggle__button--active': mobileView === 'board' }"
            aria-label="看板檢視"
            @click="mobileView = 'board'"
          >
            <AppIcon name="list" :size="15" />
          </button>
          <button
            type="button"
            :class="{ 'trip-view-toggle__button--active': mobileView === 'map' }"
            aria-label="地圖檢視"
            @click="mobileView = 'map'"
          >
            <AppIcon name="pin" :size="15" />
          </button>
        </div>
        <BaseButton variant="primary" :loading="isCopying" @click="handleCopy">
          <AppIcon name="plus" :size="14" />
          複製行程
        </BaseButton>
      </template>
    </PageHeader>

    <div class="board-workspace">
      <div v-if="isMobile && mobileView === 'board'" class="mobile-day-tabs">
        <div class="mobile-day-tabs__row">
          <button
            v-for="column in template.columns"
            :key="column.id"
            type="button"
            class="mobile-day-tabs__tab"
            :class="{ 'mobile-day-tabs__tab--active': focusedColumnId === column.id }"
            @click="focusColumn(column.id)"
          >
            {{ column.title }}
          </button>
        </div>
      </div>

      <div
        v-if="!isMobile || mobileView === 'board'"
        class="kanban-board"
        :aria-label="`${template.title} board`"
      >
        <section v-for="column in boardColumns" :key="column.id" class="kanban-column">
          <header class="kanban-column__header" :class="{ 'kanban-column__header--active': focusedColumnId === column.id }">
            <button
              type="button"
              class="kanban-column__focus"
              :aria-pressed="focusedColumnId === column.id"
              :aria-label="`在地圖上顯示 ${column.title}`"
              @click="focusColumn(column.id)"
            >
              <span class="kanban-column__title">
                <span class="kanban-column__title-text">{{ column.title }}</span>
              </span>
            </button>
          </header>

          <div class="kanban-column__cards">
            <div
              v-for="card in getColumnCards(column.placeIds)"
              :key="card.place.id"
              class="place-card-button"
              :class="{ 'place-card-button--selected': selectedPlaceId === card.place.id }"
            >
              <PlaceCard
                :place="card.place"
                :order="card.order"
                :arrival-time="card.arrivalTime"
                @open="openPlaceDrawer(card.place.id)"
              />
            </div>
          </div>
        </section>
      </div>

      <aside
        v-if="!isMobile || mobileView === 'map'"
        class="map-panel"
        aria-label="靜態地圖預覽"
      >
        <div class="map-panel__header">
          <strong>地圖檢視</strong>
          <span>{{ templatePlaces.length }} 個地點</span>
        </div>
        <div class="map-panel__canvas">
          <svg class="map-panel__route" viewBox="0 0 340 560" preserveAspectRatio="none" aria-hidden="true">
            <path v-if="routePathD" :d="routePathD" />
          </svg>
          <button
            v-for="(place, index) in templatePlaces"
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
            :aria-label="`開啟 ${place.name} 詳細資料`"
            @click="openPlaceDrawer(place.id)"
          >
            <AppIcon name="pin-solid" :size="24" />
            <span v-if="focusOrder(place.id)" class="map-pin__order">{{ focusOrder(place.id) }}</span>
          </button>
          <span class="map-panel__coord">{{ template.destination.toUpperCase() }}</span>
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
          aria-label="關閉地點詳情"
          @click="closeDrawer"
        />
      </Transition>

      <Transition :name="isMobile ? 'place-sheet-slide' : 'place-drawer-slide'">
        <aside
          v-if="drawerPlace"
          class="place-drawer"
          :class="{ 'place-drawer--sheet': isMobile }"
          aria-label="地點詳細資料面板"
        >
          <button class="place-drawer__close" type="button" aria-label="關閉面板" @click="closeDrawer">
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
                <span>抵達時間</span>
                <strong>{{ drawerPlaceSchedule?.arrivalTime }}</strong>
              </div>
              <div class="place-drawer__fact">
                <span>停留時間</span>
                <strong>{{ drawerPlace.estimatedTime }} 小時</strong>
              </div>
              <div class="place-drawer__fact">
                <span>天數</span>
                <strong>{{ getPlaceDay(drawerPlace.columnId) }}</strong>
              </div>
              <div class="place-drawer__fact">
                <span>類別</span>
                <strong>{{ categoryLabels[drawerPlace.category] }}</strong>
              </div>
            </div>

            <div v-if="drawerPlace.travelTip" class="place-drawer__tip">
              <AppIcon name="sparkle" :size="15" />
              <div>
                <b>旅遊小提示</b>
                {{ drawerPlace.travelTip }}
              </div>
            </div>

            <div class="place-drawer__actions place-drawer__actions--single">
              <BaseButton @click="viewOnMap">在地圖上查看</BaseButton>
            </div>
          </div>
        </aside>
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import CategoryChip, { categoryLabels } from '../components/trips/CategoryChip.vue'
import PlaceCard from '../components/trips/PlaceCard.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import { useColumnSchedule } from '../composables/useColumnSchedule'
import { useIsMobile } from '../composables/useIsMobile'
import { explorePlacesForTemplate, exploreTemplates } from '../data/exploreTrips'
import { buildRoutePath, markerPosition } from '../data/mapMarkers'
import { useTripsStore } from '../stores/trips'

const route = useRoute()
const router = useRouter()
// Same breakpoint as the real trip board (see global.scss) — below this
// width there's no room for the board and map side by side.
const isMobile = useIsMobile(1100)
const tripsStore = useTripsStore()

const template = computed(() => {
  const templateId = String(route.params.templateId ?? '')

  return exploreTemplates.find((item) => item.id === templateId) ?? exploreTemplates[0]
})
const templatePlaces = computed(() => explorePlacesForTemplate(template.value.id))
const { getColumnPlaces, getColumnCards, getPlaceSchedule } = useColumnSchedule(
  () => templatePlaces.value,
  () => template.value.columns,
)

const mobileView = ref<'board' | 'map'>('board')
const isCopying = ref(false)
const selectedPlaceId = ref<string | null>(null)
const drawerPlaceId = ref<string | null>(null)
const focusedColumnId = ref('')

const legendCategories = [
  { key: 'culture', label: '文化' },
  { key: 'food', label: '美食' },
  { key: 'cafe', label: '咖啡廳' },
  { key: 'nature', label: '自然' },
  { key: 'shopping', label: '購物' },
  { key: 'activity', label: '活動' },
  { key: 'museum', label: '博物館' },
  { key: 'transport', label: '交通' },
  { key: 'stay', label: '住宿' },
]

function resolveDefaultColumnId(columns: { id: string; placeIds: string[] }[]) {
  const firstWithPlaces = columns.find((column) => column.placeIds.length > 0)

  return firstWithPlaces?.id ?? columns[0]?.id ?? ''
}

focusedColumnId.value = resolveDefaultColumnId(template.value.columns)

const headerDescription = computed(() => {
  if (isMobile.value) return template.value.destination

  return `${template.value.destination} · ${template.value.tagline}`
})

// On mobile, only the focused day's column renders at a time (tap a day tab
// to switch) instead of stacking every day in one long scroll — matches the
// real trip board's mobile behavior.
const mobileColumns = computed(() => {
  const match = template.value.columns.find((column) => column.id === focusedColumnId.value)
  return match ? [match] : template.value.columns.slice(0, 1)
})
const boardColumns = computed(() => (isMobile.value ? mobileColumns.value : template.value.columns))

const focusedPlaces = computed(() => {
  const column = template.value.columns.find((item) => item.id === focusedColumnId.value)
  if (!column) return []

  return getColumnPlaces(column.placeIds)
})
const hasFocusHighlight = computed(() => focusedPlaces.value.length > 0)
const routePathD = computed(() => buildRoutePath(focusedPlaces.value, templatePlaces.value))
const drawerPlace = computed(() => templatePlaces.value.find((place) => place.id === drawerPlaceId.value))
const drawerPlaceSchedule = computed(() => getPlaceSchedule(drawerPlace.value))
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
  () => route.params.templateId,
  () => {
    selectedPlaceId.value = null
    drawerPlaceId.value = null
    mobileView.value = 'board'
    focusedColumnId.value = resolveDefaultColumnId(template.value.columns)
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.documentElement.classList.remove('is-mobile-sheet-open')
  document.body.classList.remove('is-mobile-sheet-open')
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDrawer()
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

function openPlaceDrawer(placeId: string) {
  selectedPlaceId.value = placeId
  drawerPlaceId.value = placeId

  const place = templatePlaces.value.find((item) => item.id === placeId)
  if (place) focusedColumnId.value = place.columnId
}

function closeDrawer() {
  drawerPlaceId.value = null
}

function viewOnMap() {
  if (isMobile.value) mobileView.value = 'map'
  closeDrawer()
}

function getPlaceDay(columnId: string) {
  return template.value.columns.find((item) => item.id === columnId)?.title ?? ''
}

function handleCopy() {
  if (isCopying.value) return
  isCopying.value = true

  const trip = tripsStore.copyTemplateTrip(template.value.id)
  if (!trip) {
    isCopying.value = false
    return
  }

  // If navigation fails (e.g. a lazy-loaded chunk fetch error) the component
  // never unmounts, so isCopying must reset — otherwise the button is stuck
  // disabled with no way to retry. A successful push unmounts this page, so
  // this is a no-op on the happy path.
  router.push({ name: 'trip-board', params: { tripId: trip.id }, query: { fresh: '1' } }).catch(() => {
    isCopying.value = false
  })
}
</script>
