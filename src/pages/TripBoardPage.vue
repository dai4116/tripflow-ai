<template>
  <section class="trip-board-page">
    <PageHeader :title="activeTrip.title">
      <template #description>
        {{ activeTrip.destination }} ·
        <span :class="{ 'trip-header__unscheduled-date': !activeTrip.startDate }">
          {{ activeTrip.dateRange }}
        </span>
        · {{ activeTrip.travelers }} 位旅伴
      </template>

      <template #badge>
        <button
          type="button"
          class="trip-settings-trigger"
          aria-label="編輯旅程設定"
          @click="showTripSettingsModal = true"
        >
          <AppIcon name="gear" :size="16" />
        </button>
      </template>

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
        <DayStepper
          v-if="!isMobile"
          :columns="displayedColumns"
          show-labels
          @add="addDay"
          @delete="confirmDeleteDayById"
        />
      </template>
    </PageHeader>

    <Transition name="board-toast-fade">
      <div v-if="boardToastMessage" class="board-toast" role="status">
        {{ boardToastMessage }}
      </div>
    </Transition>

    <Transition name="board-reveal" mode="out-in">
      <div
        v-if="showSkeleton"
        key="skeleton"
        class="kanban-skeleton"
        role="status"
        aria-label="正在生成你的行程看板"
      >
        <div v-for="column in displayedColumns" :key="column.id" class="kanban-skeleton__column">
          <div class="kanban-skeleton__header" />
          <div v-for="n in Math.max(column.placeIds.length, 1)" :key="n" class="kanban-skeleton__card" />
        </div>
      </div>

      <div v-else key="board" class="board-workspace">
      <DayTabs
        v-if="isMobile && mobileView === 'board'"
        :columns="displayedColumns"
        :focused-column-id="focusedColumnId"
        editable
        @focus-column="focusColumn"
        @add="addDay"
        @delete="confirmDeleteDayById"
      />
      <div
        v-if="!isMobile || mobileView === 'board'"
        class="kanban-board"
        :class="{ 'kanban-board--dragging': isDraggingCard, 'kanban-board--fresh-enter': isFreshEntry }"
        :aria-label="`${activeTrip.title} board`"
      >
        <section
          v-for="column in boardColumns"
          :key="column.id"
          class="kanban-column"
          :class="{ 'kanban-column--enter': newlyAddedColumnId === column.id }"
        >
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
                <span v-if="columnDate(column)" class="kanban-column__date">{{ columnDate(column) }}</span>
              </span>
            </button>
          </header>

          <VueDraggable
            v-model="column.placeIds"
            class="kanban-column__cards"
            group="kanban-places"
            :animation="150"
            :delay="150"
            :delay-on-touch-only="true"
            :touch-start-threshold="5"
            :force-fallback="true"
            :fallback-tolerance="5"
            :scroll-sensitivity="80"
            :scroll-speed="16"
            :bubble-scroll="true"
            draggable=".place-card-button"
            filter=".place-card__warning-trigger"
            :prevent-on-filter="false"
            ghost-class="place-card-button--ghost"
            chosen-class="place-card-button--chosen"
            drag-class="place-card-button--dragging"
            @start="isDraggingCard = true"
            @end="onDragEnd"
          >
            <div
              v-for="entry in columnCardEntries(column)"
              :key="entry.card.place.id"
              class="place-card-button"
              :class="{ 'place-card-button--selected': selectedPlaceId === entry.card.place.id }"
            >
              <PlaceCard
                :place="entry.card.place"
                :order="entry.card.order"
                :arrival-time="entry.card.arrivalTime"
                :has-time-overlap="entry.card.hasTimeOverlap"
                :overlap-reason="entry.card.overlapReason"
                :overlap-warning-open="overlapWarningPlaceId === entry.card.place.id"
                @open="openPlaceDrawer(entry.card.place.id)"
                @toggle-overlap-warning="toggleOverlapWarning(entry.card.place.id)"
                @close-overlap-warning="closeOverlapWarning"
              />
              <TravelTimeRow
                v-if="entry.nextPlace"
                :place="entry.card.place"
                :next-place="entry.nextPlace"
                @open="openTravelTimeModal(entry.card.place, entry.nextPlace)"
              />
            </div>
            <p v-if="column.placeIds.length === 0 && isMobile" class="kanban-column__empty">請新增景點</p>
          </VueDraggable>

          <button
            v-if="!isMobile"
            type="button"
            class="kanban-column__add-place"
            @click="openAddPlaceModal(column.id)"
          >
            <AppIcon name="plus" :size="12" />
            新增地點
          </button>
        </section>
      </div>

      <TripMap
        v-if="!isMobile || mobileView === 'map'"
        :places="tripPlaces"
        :focused-place-ids="focusedPlaces.map((place) => place.id)"
        :selected-place-id="selectedPlaceId"
        :destination="activeTrip.destination"
        :columns="displayedColumns"
        :focused-column-id="focusedColumnId"
        editable
        @select="openPlaceDrawer"
        @focus-column="focusColumn"
        @add="addDay"
        @delete="confirmDeleteDayById"
      />

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
          <button
            v-if="!isEditingPlace"
            class="place-drawer__edit-toggle"
            type="button"
            aria-label="編輯地點詳情"
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
                  <span>抵達時間</span>
                  <strong>{{ drawerPlaceSchedule?.arrivalTime }}</strong>
                </div>
                <div class="place-drawer__fact">
                  <span>
                    {{ drawerPlace.scheduleMode === 'departure' && drawerPlace.departureTime ? '離開時間' : '停留時間' }}
                  </span>
                  <strong>
                    {{
                      drawerPlace.scheduleMode === 'departure' && drawerPlace.departureTime
                        ? drawerPlace.departureTime
                        : formatStayDuration(drawerPlace.estimatedTime)
                    }}
                  </strong>
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

              <div class="place-drawer__actions">
                <BaseButton @click="viewOnMap">在地圖上查看</BaseButton>
                <div class="place-drawer__move-wrap">
                  <BaseButton variant="secondary" @click="isMoveMenuOpen = !isMoveMenuOpen">移動天數</BaseButton>
                  <DayPickerSheet
                    v-if="isMoveMenuOpen"
                    direction="above"
                    :columns="displayedColumns"
                    title="請選擇要移動到的天數"
                    :disabled-column-id="drawerPlace.columnId"
                    @select="moveDrawerPlaceTo"
                  />
                </div>
                <BaseButton class="place-drawer__remove" variant="ghost" @click="removeDrawerPlace">移除地點</BaseButton>
              </div>
              <button
                v-if="isMoveMenuOpen"
                class="place-drawer__move-backdrop"
                type="button"
                aria-label="關閉移動選單"
                @click="isMoveMenuOpen = false"
              />
            </template>

            <div v-else class="place-drawer__edit-form">
              <BaseInput v-model="editForm.name" label="名稱" placeholder="地點名稱" />

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

              <div class="place-drawer__toggle-field">
                <span class="place-drawer__field-label">抵達時間</span>

                <div class="place-drawer__toggle-card">
                  <div
                    class="place-drawer__toggle-row"
                    :class="{ 'place-drawer__toggle-row--active': editForm.arrivalTimeMode === 'auto' }"
                    @click="editForm.arrivalTimeMode = 'auto'"
                  >
                    <span class="place-drawer__toggle-row-label">系統規劃</span>
                    <span class="place-drawer__toggle-row-value">{{ editForm.arrivalTimeAuto }}</span>
                    <label class="place-drawer__toggle-radio">
                      <input v-model="editForm.arrivalTimeMode" type="radio" name="arrivalTimeMode" value="auto" />
                      <span class="place-drawer__toggle-radio-dot"><AppIcon name="check" :size="10" /></span>
                    </label>
                  </div>

                  <div class="place-drawer__toggle-divider" />

                  <div
                    class="place-drawer__toggle-row"
                    :class="{ 'place-drawer__toggle-row--active': editForm.arrivalTimeMode === 'manual' }"
                    @click="editForm.arrivalTimeMode = 'manual'"
                  >
                    <span class="place-drawer__toggle-row-label">手動設定</span>
                    <button
                      type="button"
                      class="place-drawer__toggle-row-input place-drawer__toggle-row-button"
                      :disabled="editForm.arrivalTimeMode !== 'manual'"
                      @click.stop="openTimePicker('arrivalManual', $event)"
                    >
                      {{ editForm.arrivalTimeManual }}
                    </button>
                    <label class="place-drawer__toggle-radio" @click.stop>
                      <input v-model="editForm.arrivalTimeMode" type="radio" name="arrivalTimeMode" value="manual" />
                      <span class="place-drawer__toggle-radio-dot"><AppIcon name="check" :size="10" /></span>
                    </label>
                  </div>
                </div>
              </div>

              <div class="place-drawer__toggle-field">
                <span class="place-drawer__field-label">此景點</span>

                <div class="place-drawer__toggle-card">
                  <div
                    class="place-drawer__toggle-row"
                    :class="{ 'place-drawer__toggle-row--active': editForm.stayMode === 'duration' }"
                    @click="selectStayMode('duration')"
                  >
                    <span class="place-drawer__toggle-row-label">停留時間</span>
                    <button
                      type="button"
                      class="place-drawer__toggle-row-input place-drawer__toggle-row-button"
                      :disabled="editForm.stayMode !== 'duration'"
                      @click.stop="openTimePicker('stayDuration', $event)"
                    >
                      {{ editForm.stayDuration }}
                    </button>
                    <label class="place-drawer__toggle-radio" @click.stop="selectStayMode('duration')">
                      <input :checked="editForm.stayMode === 'duration'" type="radio" name="stayMode" value="duration" />
                      <span class="place-drawer__toggle-radio-dot"><AppIcon name="check" :size="10" /></span>
                    </label>
                  </div>

                  <div class="place-drawer__toggle-divider" />

                  <div
                    class="place-drawer__toggle-row"
                    :class="{ 'place-drawer__toggle-row--active': editForm.stayMode === 'departure' }"
                    @click="selectStayMode('departure')"
                  >
                    <span class="place-drawer__toggle-row-label">離開時間</span>
                    <button
                      type="button"
                      class="place-drawer__toggle-row-input place-drawer__toggle-row-button"
                      :disabled="editForm.stayMode !== 'departure'"
                      @click.stop="openTimePicker('stayDeparture', $event)"
                    >
                      {{ editForm.stayDeparture }}
                    </button>
                    <label class="place-drawer__toggle-radio" @click.stop="selectStayMode('departure')">
                      <input :checked="editForm.stayMode === 'departure'" type="radio" name="stayMode" value="departure" />
                      <span class="place-drawer__toggle-radio-dot"><AppIcon name="check" :size="10" /></span>
                    </label>
                  </div>
                </div>
              </div>

              <BaseInput v-model="editForm.description" label="筆記" multiline :rows="3" />
              <BaseInput v-model="editForm.travelTip" label="旅遊小提示（選填）" placeholder="選填提示" />

              <div class="place-drawer__edit-actions">
                <BaseButton variant="secondary" @click="cancelEdit">取消</BaseButton>
                <BaseButton :disabled="!editForm.name.trim()" @click="saveEdit">儲存變更</BaseButton>
              </div>
            </div>
          </div>
        </aside>
      </Transition>

      <TripSettingsModal
        v-if="showTripSettingsModal"
        :trip="activeTrip"
        @close="showTripSettingsModal = false"
        @save="onSaveTripSettings"
      />

      <AddPlaceModal
        v-if="showAddModal"
        :column-id="addModalColumnId"
        :column-title="addModalColumnTitle"
        :city="cityName"
        :existing-names="tripPlaces.map((place) => place.name)"
        @close="showAddModal = false"
        @add="onAddPlace"
      />

      <TravelTimeModal
        v-if="travelTimeFromPlace && travelTimeToPlace"
        :from-place="travelTimeFromPlace"
        :to-place="travelTimeToPlace"
        @close="closeTravelTimeModal"
        @save="saveTravelTime"
      />

      <ConfirmModal
        v-if="confirmDialog.open"
        :title="confirmDialog.title"
        :message="confirmDialog.message"
        :confirm-label="confirmDialog.confirmLabel"
        :danger="confirmDialog.danger"
        @confirm="acceptConfirm"
        @cancel="closeConfirm"
      />

      <TimePickerSheet
        v-if="timePickerTarget"
        :key="timePickerTarget"
        :model-value="timePickerInitialValue"
        :title="timePickerTitle"
        :anchor-el="timePickerAnchorEl"
        @update:model-value="confirmTimePicker"
        @close="closeTimePicker"
      />

      <button
        v-if="isMobile && mobileView === 'board'"
        type="button"
        class="kanban-mobile-add-fab"
        :aria-label="`新增地點到 ${focusedColumnTitle}`"
        @click="openAddPlaceModal(focusedColumnId)"
      >
        <AppIcon name="plus" :size="18" />
      </button>

      <AskAiPanel :trip-id="activeTrip.id" @applied="focusColumn" />
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
import DayPickerSheet from '../components/trips/DayPickerSheet.vue'
import DayStepper from '../components/trips/DayStepper.vue'
import DayTabs from '../components/trips/DayTabs.vue'
import PlaceCard from '../components/trips/PlaceCard.vue'
import TravelTimeModal from '../components/trips/TravelTimeModal.vue'
import TravelTimeRow from '../components/trips/TravelTimeRow.vue'
import TripMap from '../components/trips/TripMap.vue'
import TripSettingsModal from '../components/trips/TripSettingsModal.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'
import TimePickerSheet from '../components/ui/TimePickerSheet.vue'
import { useColumnSchedule } from '../composables/useColumnSchedule'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useIsMobile } from '../composables/useIsMobile'
import { computeTripDays, formatDateRange, toDateInputValue } from '../data/generateTrip'
import {
  addMinutes,
  computeArrivalTimes,
  formatStayDuration,
  hhmmToHours,
  hoursToHHMM,
  minutesBetween,
} from '../data/placeSchedule'
import { useTripsStore } from '../stores/trips'
import type { Place, PlaceCategory, PlaceScheduleMode, TravelMode, TripColumn } from '../types'

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
const overlapWarningPlaceId = ref<string | null>(null)
const OVERLAP_WARNING_DURATION = 3000
// iOS Safari doesn't focus a tapped <button>, so the tag's @blur close never
// fires there — auto-dismissing on a timer works regardless of platform.
let overlapWarningTimeoutId: ReturnType<typeof setTimeout> | null = null
const isDraggingCard = ref(false)
// Generic transient confirmation banner for day deletion, desktop day
// creation, and moving a place to another day from the drawer.
const boardToastMessage = ref('')
const BOARD_TOAST_DURATION = 2200
let boardToastTimeoutId: ReturnType<typeof setTimeout> | null = null
const focusedColumnId = ref('')
const isFreshEntry = ref(route.query.fresh === '1')
const showSkeleton = ref(isFreshEntry.value)
const BOARD_SKELETON_DURATION = 650

const { confirmDialog, openConfirm, closeConfirm, acceptConfirm } = useConfirmDialog()

const showAddModal = ref(false)
const showTripSettingsModal = ref(false)
const travelTimeFromPlace = ref<Place | null>(null)
const travelTimeToPlace = ref<Place | null>(null)
const addModalColumnId = ref('')
const newlyAddedColumnId = ref('')
const NEW_COLUMN_ENTER_DURATION = 400
const isMoveMenuOpen = ref(false)
const isEditingPlace = ref(false)
const editForm = reactive({
  name: '',
  category: 'activity' as PlaceCategory,
  description: '',
  travelTip: '',
  arrivalTimeMode: 'auto' as 'auto' | 'manual',
  arrivalTimeManual: '',
  // Display-only — what "系統規劃" would show even while "手動設定" is
  // active, so switching back doesn't lose track of the computed value.
  arrivalTimeAuto: '',
  // These remain independent values. stayMode only chooses which one is
  // presented as the place's active schedule summary.
  stayMode: 'duration' as PlaceScheduleMode,
  stayDuration: '01:00',
  stayDeparture: '',
})

const activeTrip = computed(() => {
  const tripId = String(route.params.tripId ?? 'tokyo-explorer')

  return trips.value.find((trip) => trip.id === tripId) ?? trips.value[0]
})

// Seed trips ship with `columns: []` until someone actually opens the board.
// Materialize real day columns onto the trip itself (rather than just
// rendering a placeholder) so id-based lookups — like adding a place, which
// finds the column by id on the trip's actual data — have something real to
// write into.
function ensureColumns() {
  const trip = activeTrip.value
  if (trip.columns.length > 0) return

  const dayCount = Math.max(1, trip.days || 3)
  trip.columns = Array.from({ length: dayCount }, (_, index) => ({
    id: `day-${index + 1}`,
    title: `第${index + 1}天`,
    dayNumber: index + 1,
    placeIds: [],
  }))
}

ensureColumns()

const displayedColumns = computed(() => activeTrip.value.columns)
const tripPlaces = computed(() => places.value.filter((place) => place.tripId === activeTrip.value.id))
const { getColumnPlaces, getColumnCards, getPlaceSchedule } = useColumnSchedule(
  () => tripPlaces.value,
  () => displayedColumns.value,
)

// Bundles each card with its immediate successor (or null if it's last in
// the day) so the template can bind TravelTimeRow's next-place prop without
// repeating the lookup — and so Vue's template type-narrowing on
// `entry.nextPlace` actually works, unlike calling a lookup function
// separately in v-if and each binding.
function columnCardEntries(column: TripColumn) {
  // cards is already in placeIds order — reading the next element off it
  // directly (instead of a separate tripPlaces.value.find per card) avoids
  // an O(cards × tripPlaces) re-lookup on every render.
  const cards = getColumnCards(column.placeIds)
  return cards.map((card, index) => ({
    card,
    nextPlace: cards[index + 1]?.place ?? null,
  }))
}
// On mobile, only the focused day's cards render at a time (tap a day tab to
// switch) instead of horizontally scrolling between columns — swiping the
// board to change days fought with dragging a card to reorder it, since both
// are touch gestures on the same cards.
const mobileColumns = computed(() => {
  const match = displayedColumns.value.find((column) => column.id === focusedColumnId.value)
  return match ? [match] : displayedColumns.value.slice(0, 1)
})
const boardColumns = computed(() => (isMobile.value ? mobileColumns.value : displayedColumns.value))
const addModalColumnTitle = computed(
  () => displayedColumns.value.find((column) => column.id === addModalColumnId.value)?.title ?? '',
)
const focusedColumnTitle = computed(
  () => displayedColumns.value.find((column) => column.id === focusedColumnId.value)?.title ?? '',
)

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
const drawerPlace = computed(() => tripPlaces.value.find((place) => place.id === drawerPlaceId.value))
const drawerPlaceSchedule = computed(() => getPlaceSchedule(drawerPlace.value))
const shouldLockBodyScroll = computed(() => isMobile.value && Boolean(drawerPlace.value))
const cityName = computed(() => activeTrip.value.destination.split(/[,，]/)[0].trim() || activeTrip.value.destination)

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
    closeOverlapWarning()
    clearBoardToast()
    isMoveMenuOpen.value = false
    isEditingPlace.value = false
    showAddModal.value = false
    showTripSettingsModal.value = false
    closeTimePicker()
    ensureColumns()
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
  if (overlapWarningTimeoutId !== null) clearTimeout(overlapWarningTimeoutId)
  clearBoardToast()
  window.removeEventListener('keydown', onKeydown)
  document.documentElement.classList.remove('is-mobile-sheet-open')
  document.body.classList.remove('is-mobile-sheet-open')
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDrawer()
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// Trips copied from Explore do not have a real date yet. Hide the date slot
// until the user schedules one instead of showing placeholder text here.
function columnDate(column: TripColumn): string {
  if (!activeTrip.value.startDate) return ''

  const date = new Date(activeTrip.value.startDate)
  if (Number.isNaN(date.getTime())) return ''

  date.setDate(date.getDate() + (column.dayNumber - 1))
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAY_LABELS[date.getDay()]})`
}

function closeOverlapWarning() {
  if (overlapWarningTimeoutId !== null) {
    clearTimeout(overlapWarningTimeoutId)
    overlapWarningTimeoutId = null
  }
  overlapWarningPlaceId.value = null
}

function clearBoardToast() {
  if (boardToastTimeoutId !== null) {
    clearTimeout(boardToastTimeoutId)
    boardToastTimeoutId = null
  }
  boardToastMessage.value = ''
}

function showBoardToast(message: string) {
  clearBoardToast()
  boardToastMessage.value = message
  boardToastTimeoutId = setTimeout(clearBoardToast, BOARD_TOAST_DURATION)
}

function toggleOverlapWarning(placeId: string) {
  if (overlapWarningPlaceId.value === placeId) {
    closeOverlapWarning()
    return
  }

  closeOverlapWarning()
  overlapWarningPlaceId.value = placeId
  overlapWarningTimeoutId = setTimeout(closeOverlapWarning, OVERLAP_WARNING_DURATION)
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
  closeOverlapWarning()
  syncPlaceColumns()
  tripsStore.recalcPlaceCount(activeTrip.value)
  // Reordering can change which place is "next" for any gap on the board —
  // fillMissingTravelTimes re-checks every gap's travelToNext.toPlaceId
  // against current adjacency, so this is safe to call unconditionally
  // rather than trying to work out exactly which gaps moved.
  tripsStore.fillMissingTravelTimes(activeTrip.value.id)
  isDraggingCard.value = false
}

function openPlaceDrawer(placeId: string) {
  closeOverlapWarning()
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
  addModalColumnId.value = columnId
  showAddModal.value = true
}

function openTravelTimeModal(fromPlace: Place, toPlace: Place) {
  travelTimeFromPlace.value = fromPlace
  travelTimeToPlace.value = toPlace
}

function closeTravelTimeModal() {
  travelTimeFromPlace.value = null
  travelTimeToPlace.value = null
}

function saveTravelTime(payload: { mode: TravelMode; durationMin: number; distanceKm?: number }) {
  if (!travelTimeFromPlace.value || !travelTimeToPlace.value) return
  tripsStore.setTravelToNext(travelTimeFromPlace.value.id, travelTimeToPlace.value.id, payload.mode, payload.durationMin, payload.distanceKm)
  closeTravelTimeModal()
}

function confirmDeleteDay(column: TripColumn) {
  openConfirm({
    title: `刪除第 ${column.dayNumber} 天？`,
    message: '這天及這天所有行程都會一併刪除，刪除後無法復原喔。',
    confirmLabel: '刪除',
    danger: true,
    onConfirm: () => removeDay(column.id),
  })
}

function confirmDeleteDayById(columnId: string) {
  const column = displayedColumns.value.find((item) => item.id === columnId)
  if (column) confirmDeleteDay(column)
}

function onAddPlace(payload: { columnId: string; name: string; category: PlaceCategory; description: string }) {
  tripsStore.addPlace({ tripId: activeTrip.value.id, ...payload })
}

// addDay()/removeDay() change the trip's day count without going through
// onSaveTripSettings — trip.dateRange is a separately stored display string,
// not derived on the fly from startDate + day count, so it goes stale
// (still showing the old end date) unless recomputed here too.
function recalcDateRange() {
  const trip = activeTrip.value
  if (!trip.startDate) return

  const start = new Date(trip.startDate)
  if (Number.isNaN(start.getTime())) return

  const end = new Date(start)
  end.setDate(end.getDate() + (trip.columns.length - 1))
  trip.dateRange = formatDateRange(trip.startDate, toDateInputValue(end))
}

function addDay() {
  const nextDayNumber = displayedColumns.value.length + 1
  // nanoid rather than `day-${nextDayNumber}` — after a mid-list day is
  // removed and the rest renumbered, a position-based id could collide with
  // a survivor that kept its original id.
  const newColumn: TripColumn = { id: `day-${nanoid(6)}`, dayNumber: nextDayNumber, title: `第${nextDayNumber}天`, placeIds: [] }
  activeTrip.value.columns = [...displayedColumns.value, newColumn]
  activeTrip.value.days = activeTrip.value.columns.length
  recalcDateRange()

  // Focusing it lights up its header teal (same as clicking it) and syncs
  // the map — a newly created day has no prior context worth preserving, so
  // jumping focus there doubles as the "yes, it was added" confirmation.
  //
  // Deliberately NOT auto-scrolling the kanban-board/cards into view: any
  // programmatic scroll of those containers — scrollTo() or a direct
  // scrollLeft assignment, smooth or instant, immediately or delayed —
  // permanently breaks cross-column drag-in, and not just for the newly
  // mounted column — every cross-column drag on the board fails afterward.
  // Sortable's own bubble-scroll/scroll-sensitivity auto-scroll listeners on
  // those same containers appear to get confused by a scroll they didn't
  // initiate. Re-confirmed with a scripted repro after the column layout
  // moved from CSS grid to flex — still reproduces, so this isn't a
  // layout-specific fluke. showBoardToast() below is the substitute "yes,
  // it happened" cue for desktop instead.
  //
  // The mobile day-tab strip (DayTabs.vue) is a different, plain
  // (non-Sortable) element, so it's safe to scroll — and on mobile it's the
  // only way to see that a new day was added, since only the focused
  // column's cards render. DayTabs.vue watches focusedColumnId itself and
  // scrolls the new tab into view, so setting it here is enough.
  focusedColumnId.value = newColumn.id
  newlyAddedColumnId.value = newColumn.id
  window.setTimeout(() => {
    if (newlyAddedColumnId.value === newColumn.id) newlyAddedColumnId.value = ''
  }, NEW_COLUMN_ENTER_DURATION)

  if (!isMobile.value) {
    showBoardToast(`已新增第 ${nextDayNumber} 天`)
  }
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
    .map((item, index) => ({ ...item, dayNumber: index + 1, title: `第${index + 1}天` }))
  activeTrip.value.days = activeTrip.value.columns.length
  recalcDateRange()

  if (drawerPlaceId.value && placeIdsToRemove.has(drawerPlaceId.value)) closeDrawer()
  if (focusedColumnId.value === columnId) focusedColumnId.value = resolveDefaultColumnId(displayedColumns.value)
  showBoardToast(`已刪除天數`)
}

// Editing the trip's date range in the settings modal can change how many
// day-columns the trip needs. Growing just appends empty days (safe);
// shrinking can orphan places sitting in the trailing days it drops, so that
// path goes through the same confirm dialog as deleting a day by hand.
function onSaveTripSettings(payload: { title: string; startDate: string; endDate: string }) {
  const trip = activeTrip.value
  const newDays = computeTripDays({ startDate: payload.startDate, endDate: payload.endDate })
  const currentDays = displayedColumns.value.length

  function applyMeta() {
    trip.title = payload.title
    trip.startDate = payload.startDate
    trip.dateRange = formatDateRange(payload.startDate, payload.endDate)
    trip.days = newDays
    showTripSettingsModal.value = false
  }

  if (newDays === currentDays) {
    applyMeta()
    return
  }

  if (newDays > currentDays) {
    const additions: TripColumn[] = Array.from({ length: newDays - currentDays }, (_, index) => {
      const dayNumber = currentDays + index + 1
      return { id: `day-${nanoid(6)}`, dayNumber, title: `第${dayNumber}天`, placeIds: [] }
    })
    trip.columns = [...displayedColumns.value, ...additions]
    applyMeta()
    return
  }

  const survivors = displayedColumns.value.slice(0, newDays)
  const dropped = displayedColumns.value.slice(newDays)
  const placeIdsToRemove = new Set(dropped.flatMap((column) => column.placeIds))

  function applyShrink() {
    if (placeIdsToRemove.size > 0) {
      places.value = places.value.filter((place) => !placeIdsToRemove.has(place.id))
    }
    trip.columns = survivors
    if (drawerPlaceId.value && placeIdsToRemove.has(drawerPlaceId.value)) closeDrawer()
    if (focusedColumnId.value && !survivors.some((column) => column.id === focusedColumnId.value)) {
      focusedColumnId.value = resolveDefaultColumnId(survivors)
    }
    applyMeta()
  }

  if (placeIdsToRemove.size > 0) {
    openConfirm({
      title: '縮短行程天數？',
      message: `新的日期範圍少了 ${dropped.length} 天，這幾天裡的 ${placeIdsToRemove.size} 個地點會一併刪除，刪除後無法復原喔。`,
      confirmLabel: '確定縮短',
      danger: true,
      onConfirm: applyShrink,
    })
  } else {
    applyShrink()
  }
}

function removeDrawerPlace() {
  if (!drawerPlace.value) return
  const place = drawerPlace.value

  openConfirm({
    title: `移除「${place.name}」？`,
    message: '這個地點會從行程中移除，此動作無法復原。',
    confirmLabel: '移除',
    danger: true,
    onConfirm: () => {
      tripsStore.removePlace(place.id)
      closeDrawer()
    },
  })
}

function moveDrawerPlaceTo(columnId: string) {
  if (!drawerPlace.value) return

  const targetColumn = displayedColumns.value.find((column) => column.id === columnId)
  tripsStore.movePlaceToColumn(drawerPlace.value.id, columnId)
  focusedColumnId.value = columnId
  closeDrawer()
  if (targetColumn) showBoardToast(`已移動到${targetColumn.title}`)
}

const editFormEffectiveArrival = computed(() =>
  editForm.arrivalTimeMode === 'manual' ? editForm.arrivalTimeManual : editForm.arrivalTimeAuto,
)

const editFormStayHours = computed(() => hhmmToHours(editForm.stayDuration))

// stayDuration/stayDeparture are two representations of the same underlying
// gap. Switching stayMode without going through confirmTimePicker (i.e.
// clicking the row/radio directly rather than picking a new value) must
// still re-derive the side being switched TO from the other, or it saves
// whatever stale snapshot was sitting there from when the form opened.
function selectStayMode(mode: PlaceScheduleMode) {
  if (editForm.stayMode === mode) return
  if (mode === 'departure') {
    editForm.stayDeparture = addMinutes(editFormEffectiveArrival.value, Math.round(hhmmToHours(editForm.stayDuration) * 60))
  } else {
    editForm.stayDuration = hoursToHHMM(minutesBetween(editFormEffectiveArrival.value, editForm.stayDeparture) / 60)
  }
  editForm.stayMode = mode
}

const timePickerTarget = ref<'arrivalManual' | 'stayDuration' | 'stayDeparture' | null>(null)
const timePickerAnchorEl = ref<HTMLElement | null>(null)
const timePickerTitle = computed(() => {
  if (timePickerTarget.value === 'arrivalManual') return '選擇抵達時間'
  if (timePickerTarget.value === 'stayDuration') return '選擇停留時間'
  return '選擇離開時間'
})
const timePickerInitialValue = computed(() => {
  if (timePickerTarget.value === 'arrivalManual') return editForm.arrivalTimeManual
  if (timePickerTarget.value === 'stayDuration') return editForm.stayDuration
  if (timePickerTarget.value === 'stayDeparture') return editForm.stayDeparture
  return '00:00'
})

function openTimePicker(target: 'arrivalManual' | 'stayDuration' | 'stayDeparture', event: MouseEvent) {
  if (timePickerTarget.value === target) {
    closeTimePicker()
    return
  }

  timePickerAnchorEl.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  timePickerTarget.value = target
}

function closeTimePicker() {
  timePickerTarget.value = null
  timePickerAnchorEl.value = null
}

// Mode only switches once a value is actually confirmed — opening the
// picker to look, then dismissing it, leaves 系統規劃/停留時間 untouched.
function confirmTimePicker(value: string) {
  if (timePickerTarget.value === 'arrivalManual') {
    editForm.arrivalTimeMode = 'manual'
    editForm.arrivalTimeManual = value
  } else if (timePickerTarget.value === 'stayDuration') {
    editForm.stayMode = 'duration'
    editForm.stayDuration = value
  } else if (timePickerTarget.value === 'stayDeparture') {
    editForm.stayMode = 'departure'
    editForm.stayDeparture = value
  }
  timePickerTarget.value = null
  timePickerAnchorEl.value = null
}

function startEdit() {
  const place = drawerPlace.value
  if (!place) return

  editForm.name = place.name
  editForm.category = place.category
  editForm.stayDuration = hoursToHHMM(place.estimatedTime)
  editForm.description = place.description
  editForm.travelTip = place.travelTip ?? ''

  // What this place's arrival time would be with no manual override, even
  // if one is currently set — so "系統規劃" always shows a real value to
  // switch back to, not just whatever was last computed.
  const column = displayedColumns.value.find((item) => item.id === place.columnId)
  const placesWithoutOverride = column
    ? getColumnPlaces(column.placeIds).map((item) => (item.id === place.id ? { ...item, arrivalTime: undefined } : item))
    : []
  const autoIndex = placesWithoutOverride.findIndex((item) => item.id === place.id)
  const autoSchedule = computeArrivalTimes(placesWithoutOverride)
  editForm.arrivalTimeAuto = (autoIndex === -1 ? undefined : autoSchedule[autoIndex]?.time) ?? '08:00'

  editForm.arrivalTimeMode = place.arrivalTime ? 'manual' : 'auto'
  editForm.arrivalTimeManual = place.arrivalTime ?? editForm.arrivalTimeAuto

  editForm.stayMode = place.scheduleMode ?? 'duration'
  editForm.stayDeparture =
    place.departureTime ?? addMinutes(editFormEffectiveArrival.value, Math.round(place.estimatedTime * 60))

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
    estimatedTime: editFormStayHours.value,
    description: editForm.description.trim() || drawerPlace.value.description,
    travelTip: editForm.travelTip.trim() || undefined,
    arrivalTime: editForm.arrivalTimeMode === 'manual' ? editForm.arrivalTimeManual || undefined : undefined,
    scheduleMode: editForm.stayMode,
    departureTime: editForm.stayDeparture || undefined,
  })
  isEditingPlace.value = false
}

function focusColumn(columnId: string) {
  focusedColumnId.value = columnId
}

function viewOnMap() {
  if (isMobile.value) mobileView.value = 'map'
  closeDrawer()
}

function getPlaceDay(columnId: string) {
  const column = displayedColumns.value.find((item) => item.id === columnId)

  return column?.title ?? '規劃中'
}
</script>
