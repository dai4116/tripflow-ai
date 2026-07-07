<template>
  <section class="new-trip-page">
    <PageHeader
      eyebrow="New itinerary"
      title="Plan a new trip ✈️"
      description="Fill in the details and AI will build your itinerary."
      :back-to="{ name: 'dashboard' }"
      back-label="Back to dashboard"
    />

    <form class="trip-form" @submit.prevent="generateTrip">
      <BaseCard class="form-card">
        <BaseInput
          v-model="form.destination"
          label="Where are you going?"
          placeholder="e.g. Tokyo, Japan"
          icon="search"
          :error="destinationError"
        />
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Trip details</h3>
        <div class="form-grid">
          <BaseInput v-model="form.duration" label="Duration (days)" type="number" icon="calendar" :min="1" :max="30" />
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

      <BaseButton
        class="trip-form__submit"
        type="submit"
        :loading="isGenerating"
      >
        <AppIcon v-if="!isGenerating" name="sparkle" :size="15" />
        {{ isGenerating ? 'Generating itinerary...' : 'Generate with AI' }}
      </BaseButton>
      <p class="trip-form__note">
        AI builds a 7-day board · curated places · optimized route
      </p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import type { IconName } from '../components/ui/icons'
import { preferences, travelStyles } from '../data/mockPreferences'
import { useTripsStore } from '../stores/trips'

const router = useRouter()
const tripsStore = useTripsStore()
const isGenerating = ref(false)
const destinationError = ref('')
const selectedPreferences = ref(['Museums', 'Local Food', 'Architecture'])
const form = reactive({
  destination: '',
  duration: '7',
  budget: '',
  travelers: '2',
  travelStyle: 'Cultural',
  avoidPlaces: '',
})

let redirectTimer: number | undefined

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
    return
  }

  destinationError.value = ''
  isGenerating.value = true
  redirectTimer = window.setTimeout(() => {
    const trip = tripsStore.createTrip({
      destination: form.destination.trim(),
      duration: Number(form.duration) || 7,
      budget: form.budget,
      travelers: Number(form.travelers) || 1,
      travelStyle: form.travelStyle,
      avoidPlaces: form.avoidPlaces,
      preferences: selectedPreferences.value,
    })
    router.push({ name: 'trip-board', params: { tripId: trip.id } })
  }, 1500)
}

onBeforeUnmount(() => {
  if (redirectTimer) {
    window.clearTimeout(redirectTimer)
  }
})
</script>
