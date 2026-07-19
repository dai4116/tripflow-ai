<template>
  <Teleport to="body">
    <div class="travel-time-modal-overlay" role="presentation" @click.self="emit('close')">
      <section class="travel-time-modal" role="dialog" aria-modal="true" aria-label="交通方式">
        <header class="travel-time-modal__header">
          <h3>交通方式</h3>
          <button type="button" class="travel-time-modal__close" aria-label="關閉" @click="emit('close')">
            <AppIcon name="close" :size="13" />
          </button>
        </header>

        <div class="travel-time-modal__route">
          <span class="travel-time-modal__route-name">{{ fromPlace.name }}</span>
          <AppIcon name="arrow-right" :size="14" class="travel-time-modal__route-arrow" />
          <span class="travel-time-modal__route-name">{{ toPlace.name }}</span>
        </div>

        <div class="travel-time-modal__tabs">
          <button
            v-for="tab in TABS"
            :key="tab.mode"
            type="button"
            class="travel-time-modal__tab"
            :class="{ 'travel-time-modal__tab--active': selectedMode === tab.mode }"
            @click="selectMode(tab.mode)"
          >
            <AppIcon :name="tab.icon" :size="15" />
            {{ tab.label }}
          </button>
        </div>

        <div v-if="selectedMode === 'manual'" class="travel-time-modal__manual">
          <span class="travel-time-modal__manual-label">自訂交通時間</span>
          <button type="button" class="travel-time-modal__manual-button" @click="openTimePicker">
            {{ manualDisplay }}
          </button>
        </div>

        <div v-else class="travel-time-modal__result">
          <p v-if="isLoading">計算中...</p>
          <p v-else-if="estimate">{{ formatTravelDuration(estimate.durationMin) }} · {{ estimate.distanceKm.toFixed(1) }} 公里</p>
          <p v-else class="travel-time-modal__result--empty">查不到這個交通方式的路線，請改用自訂輸入</p>
        </div>

        <BaseButton class="travel-time-modal__save" :disabled="!canSave" @click="save">儲存</BaseButton>
      </section>
    </div>

    <TimePickerSheet
      v-if="showTimePicker"
      :model-value="manualHHMM"
      title="預計花費時間"
      :anchor-el="timePickerAnchorEl"
      @update:model-value="confirmTimePicker"
      @close="showTimePicker = false"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchTravelTime, formatTravelDuration } from '../../data/routing'
import type { TravelEstimate } from '../../data/routing'
import type { Place, TravelMode } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseButton from '../ui/BaseButton.vue'
import TimePickerSheet from '../ui/TimePickerSheet.vue'

const props = defineProps<{
  fromPlace: Place
  toPlace: Place
}>()

const emit = defineEmits<{
  close: []
  save: [payload: { mode: TravelMode; durationMin: number; distanceKm?: number }]
}>()

const TABS: { mode: TravelMode; label: string; icon: 'car' | 'bike' | 'walk' | 'clock' }[] = [
  { mode: 'driving', label: '開車', icon: 'car' },
  { mode: 'cycling', label: '騎車', icon: 'bike' },
  { mode: 'walking', label: '走路', icon: 'walk' },
  { mode: 'manual', label: '自訂', icon: 'clock' },
]

// Pre-fill from whatever's already saved (if any) so reopening the picker
// to tweak a value doesn't lose it.
const existing = props.fromPlace.travelToNext?.toPlaceId === props.toPlace.id ? props.fromPlace.travelToNext : undefined
const selectedMode = ref<TravelMode>(existing?.mode ?? 'walking')
const manualMinutes = ref(existing && existing.mode === 'manual' ? existing.durationMin : 0)

// TimePickerSheet works in HH:MM, not raw minutes — converted at the edges
// so the rest of this component (and the saved TravelToNext) stays in plain
// minutes, same as the auto-calculated modes.
const manualHHMM = computed(() => {
  const hh = Math.floor(manualMinutes.value / 60)
  const mm = manualMinutes.value % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
})

// Reader-facing version of the same value — "5:20" from the picker reads
// back as "5 小時 20分" on the button, not the raw HH:MM. Same formatter
// TravelTimeRow.vue uses for the saved value, so the two stay in sync.
const manualDisplay = computed(() => formatTravelDuration(manualMinutes.value))

const showTimePicker = ref(false)
const timePickerAnchorEl = ref<HTMLElement | null>(null)

function openTimePicker(event: MouseEvent) {
  timePickerAnchorEl.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  showTimePicker.value = true
}

function confirmTimePicker(value: string) {
  const [hh, mm] = value.split(':').map(Number)
  manualMinutes.value = (hh || 0) * 60 + (mm || 0)
  showTimePicker.value = false
}

const estimates = ref<Partial<Record<Exclude<TravelMode, 'manual'>, TravelEstimate | null>>>({})
if (existing && existing.mode !== 'manual') {
  estimates.value[existing.mode] = { durationMin: existing.durationMin, distanceKm: existing.distanceKm ?? 0 }
}

const estimate = computed(() => (selectedMode.value === 'manual' ? null : estimates.value[selectedMode.value]))
// Derived from whether the *selected* tab's mode has an entry yet, rather
// than a shared flag set/cleared around each fetch — a shared boolean would
// show a stale "loading" state on whichever tab is active if the user
// switches tabs again before the previous tab's request lands.
const isLoading = computed(() => selectedMode.value !== 'manual' && !(selectedMode.value in estimates.value))

async function loadEstimate(mode: Exclude<TravelMode, 'manual'>) {
  if (mode in estimates.value) return

  const result = await fetchTravelTime(
    mode,
    { lat: props.fromPlace.lat, lng: props.fromPlace.lng },
    { lat: props.toPlace.lat, lng: props.toPlace.lng },
  )
  estimates.value[mode] = result
}

function selectMode(mode: TravelMode) {
  selectedMode.value = mode
  if (mode !== 'manual') loadEstimate(mode)
}

if (selectedMode.value !== 'manual') loadEstimate(selectedMode.value)

const canSave = computed(() => {
  if (selectedMode.value === 'manual') return manualMinutes.value > 0
  return Boolean(estimate.value)
})

function save() {
  if (!canSave.value) return

  if (selectedMode.value === 'manual') {
    emit('save', { mode: 'manual', durationMin: manualMinutes.value })
    return
  }

  const result = estimate.value
  if (!result) return
  emit('save', { mode: selectedMode.value, durationMin: result.durationMin, distanceKm: result.distanceKm })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
