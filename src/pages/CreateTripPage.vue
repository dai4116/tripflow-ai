<template>
  <section class="new-trip-page">
    <PageHeader
      eyebrow="New itinerary"
      title="Plan a new trip ✈️"
      description="Fill in the details and AI will build your itinerary."
      :back-to="{ name: 'dashboard' }"
      back-label="Back to dashboard"
    />

    <form v-if="!isGenerating" class="trip-form" @submit.prevent="generateTrip">
      <BaseCard class="form-card">
        <BaseInput
          ref="destinationInputRef"
          v-model="form.destination"
          label="Where are you going?"
          placeholder="e.g. Tokyo, Japan"
          icon="search"
          :error="destinationError"
        />
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Trip details</h3>
        <BaseDateRangeInput label="Travel dates" v-model:start="form.startDate" v-model:end="form.endDate" :error="dateRangeError" />
        <div class="form-grid">
          <BaseInput v-model="form.budget" label="Budget (USD)" placeholder="3,000" icon="dollar" />
          <BaseInput v-model="form.travelers" label="Travelers" type="number" icon="users" :min="1" :max="12" />
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Travel style</h3>
        <div class="choice-grid">
          <button
            v-for="style in travelStyles"
            :key="style"
            type="button"
            class="choice-pill"
            :class="{ 'choice-pill--selected': form.travelStyle === style }"
            :aria-pressed="form.travelStyle === style"
            @click="selectTravelStyle(style)"
          >
            <AppIcon :name="getStyleIcon(style)" :size="15" />
            {{ style }}
          </button>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Preferences</h3>
        <p class="form-card__hint">Select what you enjoy</p>
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
          v-model="form.avoidPlaces"
          label="Places to avoid"
          multiline
          placeholder="e.g. Avoid Shibuya on weekends, skip tourist-trap ramen chains..."
        />
      </BaseCard>

      <BaseButton class="trip-form__submit" type="submit">
        <AppIcon name="sparkle" :size="15" />
        Generate with AI
      </BaseButton>
      <p class="trip-form__note">
        AI builds a 7-day board · curated places · optimized route
      </p>
    </form>

    <BaseCard v-else class="form-card generating-card">
      <div class="generating">
        <span class="generating__badge">
          <AppIcon name="sparkle" :size="22" />
        </span>
        <h2 class="generating__title">Building your {{ cityLabel }} itinerary</h2>
        <p class="generating__subtitle">This usually takes a few seconds…</p>

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
import { preferences, travelStyles } from '../data/mockPreferences'
import { useTripsStore } from '../stores/trips'

const STAGE_DURATION = 550

const router = useRouter()
const tripsStore = useTripsStore()
const isGenerating = ref(false)
const currentStageIndex = ref(0)
const destinationError = ref('')
const dateRangeError = ref('')
const destinationInputRef = ref<InstanceType<typeof BaseInput> | null>(null)
const selectedPreferences = ref(['Museums', 'Local Food', 'Architecture'])

// YYYY-MM-DD in local time — Date#toISOString() is UTC and can land on the
// wrong calendar day depending on the visitor's timezone offset.
function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const defaultStart = new Date()
const defaultEnd = new Date()
defaultEnd.setDate(defaultEnd.getDate() + 7)

const form = reactive({
  destination: '',
  startDate: toDateInputValue(defaultStart),
  endDate: toDateInputValue(defaultEnd),
  budget: '',
  travelers: '2',
  travelStyle: 'Cultural',
  avoidPlaces: '',
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

const cityLabel = computed(() => form.destination.split(',')[0].trim() || 'your')
const stages = computed(() => [
  'Reading your preferences',
  `Scouting places in ${cityLabel.value}`,
  'Building your day-by-day plan',
  'Optimizing your route',
])

let stageTimer: number | undefined

function selectTravelStyle(style: string) {
  form.travelStyle = style
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
    Adventure: 'mountain',
    Relaxation: 'coffee',
    Cultural: 'museum',
    'Food & Drink': 'cutlery',
    Photography: 'camera',
    Nature: 'leaf',
  }

  return icons[style] ?? 'sparkle'
}

function generateTrip() {
  if (isGenerating.value) return

  if (!form.destination.trim()) {
    destinationError.value = 'Tell us where you are going first.'
    destinationInputRef.value?.focus()
    return
  }

  if (!form.startDate || !form.endDate) {
    dateRangeError.value = 'Pick your travel dates.'
    return
  }

  if (new Date(form.endDate).getTime() <= new Date(form.startDate).getTime()) {
    dateRangeError.value = 'End date must be after start date.'
    return
  }

  destinationError.value = ''
  dateRangeError.value = ''
  isGenerating.value = true
  currentStageIndex.value = 0
  advanceStage()
}

function advanceStage() {
  stageTimer = window.setTimeout(() => {
    currentStageIndex.value += 1
    if (currentStageIndex.value >= stages.value.length) {
      finishGeneration()
    } else {
      advanceStage()
    }
  }, STAGE_DURATION)
}

function finishGeneration() {
  const trip = tripsStore.createTrip({
    destination: form.destination.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    budget: form.budget,
    travelers: Number(form.travelers) || 1,
    travelStyle: form.travelStyle,
    avoidPlaces: form.avoidPlaces,
    preferences: selectedPreferences.value,
  })
  router.push({ name: 'trip-board', params: { tripId: trip.id }, query: { fresh: '1' } })
}

onBeforeUnmount(() => {
  if (stageTimer) {
    window.clearTimeout(stageTimer)
  }
})
</script>
