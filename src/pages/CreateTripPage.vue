<template>
  <section class="new-trip-page">
    <PageHeader
      title="Plan a new trip"
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
        />
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Trip details</h3>
        <div class="form-grid">
          <BaseInput v-model="form.duration" label="Duration" type="number" />
          <BaseInput v-model="form.budget" label="Budget (USD)" placeholder="$ 3,000" />
          <BaseInput v-model="form.travelers" label="Travelers" type="number" />
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
            @click="selectTravelStyle(style)"
          >
            <span>{{ getStyleIcon(style) }}</span>
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
            @click="togglePreference(preference)"
          >
            {{ preference }}
          </button>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <BaseInput
          v-model="form.avoidPlaces"
          label="Places to avoid"
          multiline
          placeholder="e.g. Avoid crowded spots, tourist traps, or specific areas..."
        />
      </BaseCard>

      <BaseButton
        class="trip-form__submit"
        type="submit"
        :loading="isGenerating"
      >
        {{ isGenerating ? 'Generating itinerary...' : '✦ Generate with AI' }}
      </BaseButton>
      <p class="trip-form__note">
        AI will build a 7-day Kanban board with curated places and an optimized route.
      </p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import { preferences, travelStyles } from '../data/mockPreferences'

const router = useRouter()
const isGenerating = ref(false)
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

function getStyleIcon(style: string) {
  const icons: Record<string, string> = {
    Adventure: '△',
    Relaxation: '☕',
    Cultural: '▣',
    'Food & Drink': '♨',
    Photography: '▧',
    Nature: '◎',
  }

  return icons[style] ?? '✦'
}

function generateTrip() {
  if (isGenerating.value) return

  isGenerating.value = true
  redirectTimer = window.setTimeout(() => {
    router.push({ name: 'trip-board' })
  }, 1500)
}

onBeforeUnmount(() => {
  if (redirectTimer) {
    window.clearTimeout(redirectTimer)
  }
})
</script>
