<template>
  <section class="new-trip-page">
    <PageHeader
      title="規劃新行程 ✈️"
      description="告訴 AI 你想去哪裡 它會幫你打造專屬行程"
      :back-to="isGenerating ? undefined : { name: 'dashboard' }"
      back-label="返回首頁"
    />

    <form v-if="!isGenerating" class="trip-form" @submit.prevent="generateTrip">
      <BaseCard class="form-card">
        <h3>你想去哪裡？</h3>
        <div class="destination-list">
          <div v-for="(city, index) in form.cities" :key="city.key" class="destination-list__row">
            <DestinationAutocomplete
              :ref="(el) => setCityInputRef(city.key, el)"
              v-model="city.destination"
              :placeholder="index === 0 ? '例如：東京' : '例如：大阪'"
              icon="search"
              :error="city.key === destinationErrorKey ? destinationError : undefined"
              :resolved="Boolean(city.destinationPlaceId)"
              @select="(selection) => onCitySelect(index, selection)"
            />
            <div class="destination-list__days">
              <button
                type="button"
                class="destination-list__day-btn"
                aria-label="減少天數"
                :disabled="city.days <= 1"
                @click="decrementDays(index)"
              >
                <AppIcon name="minus" :size="12" />
              </button>
              <span class="destination-list__day-count">{{ city.days }} 天</span>
              <button
                type="button"
                class="destination-list__day-btn"
                aria-label="增加天數"
                :disabled="totalDays >= MAX_TRIP_DAYS"
                @click="incrementDays(index)"
              >
                <AppIcon name="plus" :size="12" />
              </button>
            </div>
            <button
              v-if="form.cities.length > 1"
              type="button"
              class="destination-list__remove"
              aria-label="移除這個城市"
              @click="removeCity(index)"
            >
              <AppIcon name="close" :size="14" />
            </button>
          </div>
          <button
            v-if="form.cities.length < MAX_CITIES && totalDays < MAX_TRIP_DAYS"
            type="button"
            class="destination-list__add"
            @click="addCity"
          >
            <AppIcon name="plus" :size="13" />
            新增城市
          </button>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>行程細節</h3>
        <BaseDateInput label="出發日期" v-model="form.startDate" :error="dateRangeError" />
        <p class="form-card__hint form-card__hint--live">共 {{ totalDays }} 天・{{ dateSummary }}</p>

        <label class="flight-toggle">
          <span class="flight-toggle__copy">
            <span class="flight-toggle__title"><AppIcon name="plane" :size="14" />我知道航班時間</span>
            <span class="flight-toggle__hint">讓 AI 排得更準</span>
          </span>
          <span class="flight-toggle__switch" :class="{ 'flight-toggle__switch--on': knowsFlightTimes }">
            <input v-model="knowsFlightTimes" type="checkbox" class="flight-toggle__input" />
            <span class="flight-toggle__thumb" />
          </span>
        </label>

        <div v-if="knowsFlightTimes" class="flight-time-fields">
          <div class="flight-time-field">
            <span class="flight-time-field__label">抵達時間（選填）</span>
            <button
              ref="arrivalTimeButtonRef"
              type="button"
              class="flight-time-field__button"
              @click="openFlightTimePicker('arrival', $event)"
            >
              <AppIcon name="clock" :size="13" />
              {{ form.arrivalTime ?? '點選設定' }}
            </button>
          </div>
          <div class="flight-time-field">
            <span class="flight-time-field__label">離境時間（選填）</span>
            <button
              ref="departureTimeButtonRef"
              type="button"
              class="flight-time-field__button"
              @click="openFlightTimePicker('departure', $event)"
            >
              <AppIcon name="clock" :size="13" />
              {{ form.departureTime ?? '點選設定' }}
            </button>
          </div>
          <p class="flight-time-fields__note">請填當地時間</p>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>旅遊風格</h3>
        <p class="form-card__hint">選一個最符合你的風格</p>
        <div class="choice-grid">
          <button
            v-for="style in travelStyles"
            :key="style"
            type="button"
            class="choice-pill"
            :class="{ 'choice-pill--selected': selectedTravelStyles.includes(style) }"
            :aria-pressed="selectedTravelStyles.includes(style)"
            @click="selectTravelStyle(style)"
          >
            <AppIcon :name="getStyleIcon(style)" :size="15" />
            {{ style }}
          </button>
        </div>
        <p v-if="selectedStyleHints" class="form-card__hint form-card__hint--live">{{ selectedStyleHints }}</p>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>興趣偏好</h3>
        <p class="form-card__hint">選擇你喜歡的類型</p>
        <div class="preference-list">
          <button
            v-for="preference in preferences"
            :key="preference"
            type="button"
            class="preference-chip"
            :class="{ 'preference-chip--selected': selectedPreferences.includes(preference) }"
            :aria-pressed="selectedPreferences.includes(preference)"
            @click="togglePreference(preference)"
          >
            {{ preference }}
          </button>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <BaseInput
          v-model="form.additionalNotes"
          label="其他補充"
          multiline
          placeholder="例如：想避開觀光客拉麵店、想安排一天海邊、有素食需求..."
        />
      </BaseCard>

      <BaseButton class="trip-form__submit" type="submit">
        <AppIcon name="sparkle" :size="15" />
        開始規劃
      </BaseButton>
      <p class="trip-form__note">
        AI 會產生 {{ totalDays }} 天行程看板・精選地點・優化路線
      </p>

      <TimePickerSheet
        v-if="flightTimePickerTarget"
        :key="flightTimePickerTarget"
        :model-value="flightTimePickerInitialValue"
        :title="flightTimePickerTitle"
        :anchor-el="flightTimePickerAnchorEl"
        @update:model-value="confirmFlightTimePicker"
        @close="closeFlightTimePicker"
      />
    </form>

    <BaseCard v-else class="form-card generating-card">
      <div v-if="!generationFailed" class="generating">
        <span class="generating__badge">
          <AppIcon name="sparkle" :size="22" />
        </span>
        <h2 class="generating__title">正在為你打造 {{ cityLabel }} 行程</h2>
        <p class="generating__subtitle">{{ progressSubtitle }}</p>

        <ol class="generating__stages">
          <li
            v-for="(stage, index) in stages"
            :key="stage"
            class="generating__stage"
            :class="{
              'generating__stage--done': index < currentStageIndex,
              'generating__stage--active': index === currentStageIndex,
            }"
          >
            <span class="generating__stage-icon">
              <AppIcon v-if="index < currentStageIndex" name="check" :size="11" />
              <span v-else-if="index === currentStageIndex" class="generating__spinner" />
            </span>
            {{ stage }}
          </li>
        </ol>
      </div>

      <div v-else class="generating">
        <span class="generating__badge generating__badge--error">
          <AppIcon name="alert" :size="22" />
        </span>
        <h2 class="generating__title">行程生成失敗</h2>
        <p class="generating__subtitle">AI 暫時無法使用，請稍後再試一次。</p>

        <div class="generating__actions">
          <BaseButton @click="retryGeneration">
            <AppIcon name="sparkle" :size="15" />
            重試
          </BaseButton>
          <BaseButton variant="ghost" @click="backToForm">返回修改</BaseButton>
        </div>
      </div>
    </BaseCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import BaseDateInput from '../components/ui/BaseDateInput.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import TimePickerSheet from '../components/ui/TimePickerSheet.vue'
import type { IconName } from '../components/ui/icons'
import DestinationAutocomplete from '../components/trips/DestinationAutocomplete.vue'
import { formatDateRange, toDateInputValue } from '../data/generateTrip'
import { preferences, travelStyleHints, travelStyles } from '../data/mockPreferences'
import { useTripsStore } from '../stores/trips'

// Mirrors computeTripDays' own clamp in generateTrip.ts — kept in sync there
// rather than imported, since this bounds the day-count stepper's UI (how
// high "+" can go) while computeTripDays clamps the derived total for
// whatever actually gets submitted; the two independently agreeing is what
// keeps the stepper from ever promising a day the submission would silently
// truncate.
const MAX_TRIP_DAYS = 30
// A sane UI cap on how many destinations one trip can list — arbitrary, just
// large enough that no real itinerary hits it.
const MAX_CITIES = 8

// The real generation call now runs concurrently with this cosmetic ticker
// (see generateTrip/finishGeneration below), not after it — so this is how
// long the fake progression takes to cross all stages, not a delay before
// the real work starts. Real generation is now many small parallel per-day
// requests (see aiTripClient.ts) rather than one fixed-length request, so
// its total wait scales with trip length — computeStageDuration() below
// scales this per-stage duration the same way, instead of a flat value sized
// for the old single-request design's 40-60s (which left long trips frozen
// on the last stage for minutes with no further feedback).
let stageDurationMs = 12000

// Roughly matches real wait: a zone-planning call plus ceil(days /
// MAX_PARALLEL_REQUESTS) waves of per-day requests (see aiTripClient.ts) —
// not exact (there's no progress channel from fetchAiPlaces up to this
// component), just enough to keep the animation actively advancing through
// most of a long trip's wait instead of completing in a fixed 36s regardless
// of day count.
function computeStageDuration(): number {
  return Math.max(12000, Math.round((totalDays.value / 4) * 4000))
}

const router = useRouter()
const tripsStore = useTripsStore()
const isGenerating = ref(false)
const generationFailed = ref(false)
const currentStageIndex = ref(0)
// Flips true once the cosmetic animation reaches its last stage while the
// real request is still in flight — the animation alone can't show real
// progress past that point (see computeStageDuration's comment), so this
// swaps in a message that at least tells the user long waits are expected,
// instead of leaving the subtitle looking frozen/stuck.
const showLongWaitNotice = ref(false)
const destinationError = ref('')
// Which row in form.cities destinationError actually belongs to — a blank or
// unresolved destination can be any city in the list, not just the first, so
// the error can't just be a bare string shown under a fixed field (see the
// template's :error binding). Keyed by the row's own CityFormRow.key, not
// its array index — an index would go stale the moment a city BEFORE the
// error's row is removed (every later row's position shifts, but this
// wouldn't move with it), either hiding a still-broken field's error or
// misattributing it to whatever different city now sits at that index. null
// when there's no active destination error.
const destinationErrorKey = ref<string | null>(null)
const dateRangeError = ref('')
const selectedPreferences = ref(['必吃美食', '逛街購物', '熱門打卡'])
// Single-select — see paceForTravelStyles in generateTrip.ts for how the one
// selected style resolves directly to a pace.
const selectedTravelStyles = ref(['精準規劃'])

type CityFormRow = {
  key: string
  destination: string
  // Set when the user picks a suggestion from DestinationAutocomplete rather
  // than just typing free text — see onCitySelect below.
  destinationPlaceId?: string
  destinationLat?: number
  destinationLng?: number
  days: number
}

function makeCityRow(days = 4): CityFormRow {
  return { key: crypto.randomUUID(), destination: '', days }
}

const defaultStart = new Date()

const form = reactive({
  // Start date + each city's own day count is the source of truth (see
  // totalDays/computedEndDate below) — there's no separate end-date field to
  // keep in sync with it, unlike the old start/end range this form used to
  // collect (see BaseDateRangeInput, no longer used here).
  cities: [makeCityRow()] as CityFormRow[],
  startDate: toDateInputValue(defaultStart),
  additionalNotes: '',
  arrivalTime: undefined as string | undefined,
  departureTime: undefined as string | undefined,
})

// One DestinationAutocomplete ref per form.cities row, keyed by the row's own
// CityFormRow.key rather than its v-for index — needed for the same two
// things destinationInputRef used to do when there was only one (focus() on
// a validation failure, resolvePending() before submit), now fanned out per
// row instead of a single ref. Keyed, not an index-parallel array: Vue
// re-invokes an inline function :ref on every update where its identity
// changed (a fresh closure every render, since it captures the v-for index),
// calling the OLD closure with null and the NEW one with the element — for a
// surviving row whose index shifted after a removeCity() elsewhere in the
// list, an index-keyed array could receive that stale-index null AFTER
// removeCity's own splice already placed the right element at its new index,
// clobbering it back to null. Keying by the row's own stable key instead
// means both the old and new closures for a given row always target the same
// entry, so there's nothing for a shifted index to clobber.
const cityInputRefs = new Map<string, InstanceType<typeof DestinationAutocomplete>>()
function setCityInputRef(key: string, el: unknown) {
  // Vue calls this with null on unmount/unbind (see this const's own
  // comment) — for a REMOVED row that fires after removeCity's own delete()
  // already ran, so without this branch it would silently resurrect a
  // null-valued entry for a key that no longer exists in form.cities at all,
  // a small leak that never gets cleaned up on any later add/remove cycle.
  if (el === null) {
    cityInputRefs.delete(key)
    return
  }
  cityInputRefs.set(key, el as InstanceType<typeof DestinationAutocomplete>)
}

// Toggling off clears both times instead of just hiding the fields — a user
// who unchecks "我知道航班時間" clearly no longer wants them applied, and
// leaving stale values in `form` would silently re-send them to createTrip
// if the toggle were switched back on without the fields being touched again.
const knowsFlightTimes = ref(false)
watch(knowsFlightTimes, (value) => {
  if (!value) {
    form.arrivalTime = undefined
    form.departureTime = undefined
  }
})

const arrivalTimeButtonRef = ref<HTMLButtonElement | null>(null)
const departureTimeButtonRef = ref<HTMLButtonElement | null>(null)
const flightTimePickerTarget = ref<'arrival' | 'departure' | null>(null)
const flightTimePickerAnchorEl = ref<HTMLElement | null>(null)
const flightTimePickerTitle = computed(() => (flightTimePickerTarget.value === 'arrival' ? '選擇抵達時間' : '選擇離境時間'))
// TimePickerSheet always needs a starting 'HH:mm' to position its wheels —
// unset defaults to a plausible flight time for each direction (afternoon
// arrival, evening departure) rather than midnight.
const flightTimePickerInitialValue = computed(() => {
  if (flightTimePickerTarget.value === 'arrival') return form.arrivalTime ?? '15:00'
  return form.departureTime ?? '21:00'
})

function openFlightTimePicker(target: 'arrival' | 'departure', event: MouseEvent) {
  if (flightTimePickerTarget.value === target) {
    flightTimePickerTarget.value = null
    flightTimePickerAnchorEl.value = null
    return
  }
  flightTimePickerAnchorEl.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  flightTimePickerTarget.value = target
}

function closeFlightTimePicker() {
  flightTimePickerTarget.value = null
  flightTimePickerAnchorEl.value = null
}

function confirmFlightTimePicker(value: string) {
  if (flightTimePickerTarget.value === 'arrival') {
    form.arrivalTime = value
    arrivalTimeButtonRef.value?.focus()
  } else if (flightTimePickerTarget.value === 'departure') {
    form.departureTime = value
    departureTimeButtonRef.value?.focus()
  }
  flightTimePickerTarget.value = null
  flightTimePickerAnchorEl.value = null
}

function onCitySelect(index: number, selection: { placeId: string; lat: number; lng: number } | null) {
  const city = form.cities[index]
  if (!city) return
  city.destinationPlaceId = selection?.placeId
  city.destinationLat = selection?.lat
  city.destinationLng = selection?.lng
}

function addCity() {
  if (form.cities.length >= MAX_CITIES) return
  // Guards against the 30-day trip cap, not just the city-count cap above —
  // without this, adding a city once totalDays is already at MAX_TRIP_DAYS
  // still pushes a row with days >= 1, silently pushing the true sum past
  // the cap. totalDays' own Math.min(MAX_TRIP_DAYS, ...) clamp would then
  // hide that overflow from the UI entirely, while generateTrip.ts's
  // cityIdForDay (which walks input.cities' cumulative day counts up to
  // exactly `days`) would never reach the new city — it'd be stored in
  // trip.cities but own zero actual day columns.
  if (totalDays.value >= MAX_TRIP_DAYS) return
  form.cities.push(makeCityRow(Math.max(1, Math.min(3, MAX_TRIP_DAYS - totalDays.value))))
}

function removeCity(index: number) {
  if (form.cities.length <= 1) return
  const [removed] = form.cities.splice(index, 1)
  if (!removed) return
  cityInputRefs.delete(removed.key)
  // The removed row was the one currently showing a destination error —
  // nothing left to show it on, so drop the error rather than leave it
  // pointing at a key that no longer exists in form.cities.
  if (destinationErrorKey.value === removed.key) {
    destinationError.value = ''
    destinationErrorKey.value = null
  }
}

function incrementDays(index: number) {
  if (totalDays.value >= MAX_TRIP_DAYS) return
  const city = form.cities[index]
  if (city) city.days += 1
}

function decrementDays(index: number) {
  const city = form.cities[index]
  if (city && city.days > 1) city.days -= 1
}

// Clear each error as soon as its own field is actually fixed, rather than
// only on the next full submit — otherwise a red border can sit there
// looking wrong even after the user has already typed a valid value.
watch(
  () => form.cities.map((city) => city.destination),
  () => {
    const key = destinationErrorKey.value
    if (key === null) return
    if (form.cities.find((city) => city.key === key)?.destination.trim()) {
      destinationError.value = ''
      destinationErrorKey.value = null
    }
  },
)

watch(
  () => form.startDate,
  (value) => {
    if (value) dateRangeError.value = ''
  },
)

const totalDays = computed(() => Math.min(MAX_TRIP_DAYS, form.cities.reduce((sum, city) => sum + city.days, 0)))

// The trip's derived end date — start date + total days across every city,
// inclusive (see computeTripDays' identical +1 convention in
// generateTrip.ts). This is the only place that convention gets duplicated:
// CreateTripInput itself still takes a plain startDate/endDate pair exactly
// like before this form existed (see finishGeneration below), so nothing
// downstream needs to know "end date is derived" is even a concept.
//
// Built from form.startDate's numeric y/m/d parts, NOT `new Date(form.startDate)`
// — the string constructor parses "YYYY-MM-DD" as UTC midnight, which in any
// timezone west of UTC lands on the previous calendar day locally, so the
// setDate() arithmetic below (which reads/writes local date fields) would
// silently land one day short. Same pitfall toDateInputValue's own comment
// warns about; DashboardPage.vue's daysUntil() sidesteps it the same way.
const computedEndDate = computed(() => {
  const [year, month, day] = form.startDate.split('-').map(Number)
  if (!year || !month || !day) return form.startDate

  const end = new Date(year, month - 1, day)
  end.setDate(end.getDate() + totalDays.value - 1)
  return toDateInputValue(end)
})

const dateSummary = computed(() => {
  if (!form.startDate) return ''
  return formatDateRange(form.startDate, computedEndDate.value)
})

const cityLabel = computed(() => {
  const names = form.cities.map((city) => city.destination.split(/[,，]/)[0].trim()).filter(Boolean)
  return names.length > 0 ? names.join('・') : '你的'
})
// Live caption under the style picker — a punchy 4-character label doesn't
// say what it actually changes about the itinerary, and hover tooltips (the
// button's title attribute) don't work on touch, which is most of this app's
// usage. selectedTravelStyles only ever holds 0 or 1 elements now
// (single-select — see selectTravelStyle), so .join('；') never actually
// joins anything; kept as-is since it's harmless on a 1-element array and
// avoids a needless [0]-indexing rewrite.
const selectedStyleHints = computed(() =>
  selectedTravelStyles.value.map((style) => travelStyleHints[style]).filter(Boolean).join('；'),
)
const stages = computed(() => [
  '讀取你的偏好設定',
  `搜尋${cityLabel.value}的景點`,
  '規劃每日行程',
  '優化路線',
])
const progressSubtitle = computed(() => (showLongWaitNotice.value ? '天數較多時可能需要幾分鐘，請耐心等候…' : '請稍候…'))

let stageTimer: number | undefined

// True for the lifetime of the real tripsStore.createTrip() call — separate
// from stageTimer because the cosmetic ticker and the real request now run
// concurrently and finish independently. This is what guards retryGeneration
// against a double-click firing two real requests at once; stageTimer alone
// can't do that anymore, since it legitimately goes undefined once the
// animation reaches its last stage while the real request may still be
// in flight.
let requestInFlight = false

// stageTimer is `undefined` exactly when no stage-advance callback is
// currently pending — set by advanceStage(), cleared here and once the
// animation reaches its last stage (see advanceStage()). Used only to cancel
// a still-pending animation (backToForm, unmount); re-entrancy is
// requestInFlight's job now (see above).
function clearStageTimer() {
  if (stageTimer !== undefined) {
    window.clearTimeout(stageTimer)
    stageTimer = undefined
  }
}

function selectTravelStyle(style: string) {
  selectedTravelStyles.value = [style]
}

function togglePreference(preference: string) {
  if (selectedPreferences.value.includes(preference)) {
    selectedPreferences.value = selectedPreferences.value.filter((item) => item !== preference)
    return
  }

  selectedPreferences.value = [...selectedPreferences.value, preference]
}

function getStyleIcon(style: string): IconName {
  const icons: Record<string, IconName> = {
    精準規劃: 'list',
    自在慢旅: 'coffee',
  }

  return icons[style] ?? 'sparkle'
}

// Guards the async gap in generateTrip() between its top-of-function check
// and isGenerating.value actually flipping true. generateTrip is no longer
// synchronous up to that point now that it awaits the destination field's
// own resolution (see resolvePending), which can itself await a real network
// search — without this, a fast double-click/double-Enter landing in that
// window passes the isGenerating check twice and fires two concurrent
// tripsStore.createTrip() calls. Mirrors requestInFlight above, which guards
// the same class of race for retryGeneration.
let submitInFlight = false

async function generateTrip() {
  if (isGenerating.value || submitInFlight) return
  submitInFlight = true
  try {
    for (const city of form.cities) {
      if (!city.destination.trim()) {
        destinationError.value = '請先告訴我們你要去哪裡。'
        destinationErrorKey.value = city.key
        cityInputRefs.get(city.key)?.focus()
        return
      }
    }

    if (!form.startDate) {
      dateRangeError.value = '請選擇出發日期。'
      return
    }

    // Runs last, after every cheap synchronous check already passed — this
    // can trigger a real network search per city (see resolvePending's own
    // comment), so it's not worth paying for until the rest of the form is
    // otherwise ready to submit. Sequential, not parallel, so the first city
    // that actually needs the user's attention is the one left focused —
    // catches Enter/Confirm fired before a debounced suggestion dropdown had
    // a chance to appear: flushes any pending search and, if it turns up
    // more than one candidate, opens that city's dropdown and stops the
    // submit instead of silently falling back to unresolved free text.
    for (const city of form.cities) {
      const ref = cityInputRefs.get(city.key)
      const resolved = (await ref?.resolvePending()) ?? true
      if (!resolved) {
        destinationError.value = '請從清單中選擇一個目的地。'
        destinationErrorKey.value = city.key
        ref?.focus()
        return
      }
    }

    destinationError.value = ''
    destinationErrorKey.value = null
    dateRangeError.value = ''
    generationFailed.value = false
    isGenerating.value = true
    currentStageIndex.value = 0
    showLongWaitNotice.value = false
    stageDurationMs = computeStageDuration()
    advanceStage()
    finishGeneration()
  } finally {
    submitInFlight = false
  }
}

// Re-runs the same stage animation before hitting the AI again, rather than
// jumping straight to a bare network call — keeps retry visually consistent
// with a first attempt. Guarded by requestInFlight (not stageTimer — see its
// comment) so a double-click can't fire two real requests at once.
function retryGeneration() {
  if (requestInFlight) return
  generationFailed.value = false
  currentStageIndex.value = 0
  showLongWaitNotice.value = false
  stageDurationMs = computeStageDuration()
  advanceStage()
  finishGeneration()
}

function backToForm() {
  clearStageTimer()
  generationFailed.value = false
  isGenerating.value = false
}

// Purely cosmetic — advances through stages on a fixed timer while the real
// request (started alongside this, in generateTrip/retryGeneration) runs
// independently in finishGeneration(). Stops on the last stage rather than
// looping or resetting; if the real call is still going once it gets there,
// the last stage's spinner just keeps showing until finishGeneration()
// resolves (see its own currentStageIndex update).
function advanceStage() {
  stageTimer = window.setTimeout(() => {
    if (currentStageIndex.value >= stages.value.length - 1) {
      stageTimer = undefined
      showLongWaitNotice.value = true
      return
    }
    currentStageIndex.value += 1
    advanceStage()
  }, stageDurationMs)
}

// Set once this component unmounts (navigated away mid-generation) so the
// in-flight createTrip() call below — which keeps running regardless, since
// unmounting a Vue component doesn't cancel a pending Promise — can tell not
// to act on its own result anymore. Without this, a user who navigates away
// and starts a SECOND trip generation elsewhere would have whichever call
// finishes last force-navigate them (via the shared router singleton) to
// that trip's board, no matter where they currently are. The trip itself
// still gets created and saved either way (tripsStore.createTrip() already
// completed by the time this is checked) — this only skips the unrequested
// navigation and failure-UI update for a generation nobody's looking at
// anymore.
let cancelled = false

async function finishGeneration() {
  requestInFlight = true
  try {
    const firstCity = form.cities[0]!
    const trip = await tripsStore.createTrip({
      // The AI generation pipeline (aiTripClient.ts and below) doesn't split
      // a request per city segment yet — it needs ONE real destination to
      // search against, so that's always the first city, same as the single-
      // destination path this form used to be exclusively. See cities below
      // and CreateTripInput.cities' own comment.
      destination: firstCity.destination.trim(),
      destinationPlaceId: firstCity.destinationPlaceId,
      destinationLat: firstCity.destinationLat,
      destinationLng: firstCity.destinationLng,
      startDate: form.startDate,
      endDate: computedEndDate.value,
      travelStyle: selectedTravelStyles.value,
      additionalNotes: form.additionalNotes,
      preferences: selectedPreferences.value,
      arrivalTime: form.arrivalTime,
      departureTime: form.departureTime,
      // Only sent once there's more than one destination — a single-city
      // trip's CreateTripInput ends up with cities left undefined, exactly
      // as if this field didn't exist, so createTrip/generateTrip.ts take
      // the identical path they always have for that case.
      cities:
        form.cities.length > 1
          ? form.cities.map((city) => ({
              destination: city.destination.trim(),
              destinationPlaceId: city.destinationPlaceId,
              destinationLat: city.destinationLat,
              destinationLng: city.destinationLng,
              days: city.days,
            }))
          : undefined,
    })
    requestInFlight = false
    if (cancelled) return
    // The real call can finish before the cosmetic ticker reaches the end
    // (or after backToForm cleared it) — snap every stage to done rather
    // than leaving the UI mid-sequence for the instant before navigation.
    clearStageTimer()
    currentStageIndex.value = stages.value.length
    router.push({ name: 'trip-board', params: { tripId: trip.id }, query: { fresh: '1' } })
  } catch {
    requestInFlight = false
    if (cancelled) return
    clearStageTimer()
    generationFailed.value = true
  }
}

onBeforeUnmount(() => {
  clearStageTimer()
  cancelled = true
})
</script>
