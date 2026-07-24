<template>
  <section class="new-trip-page">
    <PageHeader
      title="規劃新行程 ✈️"
      description="填寫細節，AI 會幫你打造專屬行程。"
      :back-to="isGenerating ? undefined : { name: 'dashboard' }"
      back-label="返回首頁"
    />

    <form v-if="!isGenerating" class="trip-form" @submit.prevent="generateTrip">
      <BaseCard class="form-card">
        <BaseInput
          ref="destinationInputRef"
          v-model="form.destination"
          label="你想去哪裡？"
          placeholder="例如：東京，日本"
          icon="search"
          :error="destinationError"
        />
      </BaseCard>

      <BaseCard class="form-card">
        <h3>行程細節</h3>
        <BaseDateRangeInput label="旅遊日期" v-model:start="form.startDate" v-model:end="form.endDate" :error="dateRangeError" />
        <BaseInput v-model="form.travelers" label="旅伴人數" type="number" icon="users" :min="1" :max="12" />
      </BaseCard>

      <BaseCard class="form-card">
        <h3>旅遊風格</h3>
        <p class="form-card__hint">最多選 2 個</p>
        <div class="choice-grid">
          <button
            v-for="style in travelStyles"
            :key="style"
            type="button"
            class="choice-pill"
            :class="{ 'choice-pill--selected': selectedTravelStyles.includes(style) }"
            :aria-pressed="selectedTravelStyles.includes(style)"
            @click="toggleTravelStyle(style)"
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
            <AppIcon
              v-if="selectedPreferences.includes(preference)"
              name="check"
              :size="11"
            />
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
        AI 會產生 {{ tripDays }} 天行程看板・精選地點・優化路線
      </p>
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
import BaseDateRangeInput from '../components/ui/BaseDateRangeInput.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import type { IconName } from '../components/ui/icons'
import { computeTripDays, toDateInputValue } from '../data/generateTrip'
import { preferences, travelStyleHints, travelStyles } from '../data/mockPreferences'
import { useTripsStore } from '../stores/trips'

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
  return Math.max(12000, Math.round((tripDays.value / 4) * 4000))
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
const dateRangeError = ref('')
const destinationInputRef = ref<InstanceType<typeof BaseInput> | null>(null)
const selectedPreferences = ref(['必吃美食', '人文古蹟', '特色建築'])
// Max 2 — see paceForTravelStyles in generateTrip.ts for how a 2-style
// selection resolves to one pace (averages their places-per-day numbers).
const MAX_TRAVEL_STYLES = 2
const selectedTravelStyles = ref(['深度探索'])

const defaultStart = new Date()
const defaultEnd = new Date()
// +6, not +7 — computeTripDays counts both ends inclusively, so a 7-day
// default trip spans start..start+6 (7 calendar days), not start..start+7.
defaultEnd.setDate(defaultEnd.getDate() + 6)

const form = reactive({
  destination: '',
  startDate: toDateInputValue(defaultStart),
  endDate: toDateInputValue(defaultEnd),
  travelers: '2',
  additionalNotes: '',
})

// Clear each error as soon as its own field is actually fixed, rather than
// only on the next full submit — otherwise a red border can sit there
// looking wrong even after the user has already typed a valid value.
watch(
  () => form.destination,
  (value) => {
    if (value.trim()) destinationError.value = ''
  },
)

watch(
  [() => form.startDate, () => form.endDate],
  ([start, end]) => {
    if (start && end && new Date(end).getTime() > new Date(start).getTime()) {
      dateRangeError.value = ''
    }
  },
)

const cityLabel = computed(() => form.destination.split(/[,，]/)[0].trim() || '你的')
// Live caption under the style picker — a punchy 4-character label like
// "深度探索" doesn't say what it actually changes about the itinerary, and
// hover tooltips (the button's title attribute) don't work on touch, which
// is most of this app's usage. Joins both hints when 2 styles are selected.
const selectedStyleHints = computed(() =>
  selectedTravelStyles.value.map((style) => travelStyleHints[style]).filter(Boolean).join('；'),
)
const tripDays = computed(() => computeTripDays({ startDate: form.startDate, endDate: form.endDate }))
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

function toggleTravelStyle(style: string) {
  if (selectedTravelStyles.value.includes(style)) {
    selectedTravelStyles.value = selectedTravelStyles.value.filter((item) => item !== style)
    return
  }
  if (selectedTravelStyles.value.length >= MAX_TRAVEL_STYLES) return
  selectedTravelStyles.value = [...selectedTravelStyles.value, style]
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
    深度探索: 'compass',
    熱血冒險: 'mountain',
    質感享受: 'star',
  }

  return icons[style] ?? 'sparkle'
}

function generateTrip() {
  if (isGenerating.value) return

  if (!form.destination.trim()) {
    destinationError.value = '請先告訴我們你要去哪裡。'
    destinationInputRef.value?.focus()
    return
  }

  if (!form.startDate || !form.endDate) {
    dateRangeError.value = '請選擇旅遊日期。'
    return
  }

  if (new Date(form.endDate).getTime() <= new Date(form.startDate).getTime()) {
    dateRangeError.value = '結束日期必須晚於開始日期。'
    return
  }

  destinationError.value = ''
  dateRangeError.value = ''
  generationFailed.value = false
  isGenerating.value = true
  currentStageIndex.value = 0
  showLongWaitNotice.value = false
  stageDurationMs = computeStageDuration()
  advanceStage()
  finishGeneration()
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
    const trip = await tripsStore.createTrip({
      destination: form.destination.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      travelers: Number(form.travelers) || 1,
      travelStyle: selectedTravelStyles.value,
      additionalNotes: form.additionalNotes,
      preferences: selectedPreferences.value,
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
