<template>
  <section class="new-trip-page">
    <PageHeader
      title="Plan a new trip"
      description="Fill in the details and AI will build your itinerary."
      :back-to="{ name: 'dashboard' }"
      back-label="Back to dashboard"
    />

    <form class="trip-form">
      <BaseCard class="form-card">
        <BaseInput label="Where are you going?" placeholder="e.g. Tokyo, Japan" />
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Trip details</h3>
        <div class="form-grid">
          <BaseInput label="Duration" type="number" model-value="7" />
          <BaseInput label="Budget (USD)" placeholder="$ 3,000" />
          <BaseInput label="Travelers" type="number" model-value="2" />
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Travel style</h3>
        <div class="choice-grid">
          <span
            v-for="style in travelStyles"
            :key="style"
            class="choice-pill"
            :class="{ 'choice-pill--selected': style === 'Cultural' }"
          >
            {{ style }}
          </span>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>Preferences</h3>
        <div class="preference-list">
          <StatusBadge
            v-for="preference in preferences"
            :key="preference"
            :tone="selectedPreferences.includes(preference) ? 'accent' : 'default'"
          >
            {{ preference }}
          </StatusBadge>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <BaseInput
          label="Places to avoid"
          multiline
          placeholder="e.g. Avoid crowded spots, tourist traps, or specific areas..."
        />
      </BaseCard>

      <BaseButton type="submit">Generate with AI</BaseButton>
    </form>
  </section>
</template>

<script setup lang="ts">
import PageHeader from '../components/layout/PageHeader.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { preferences, travelStyles } from '../data/mockPreferences'

const selectedPreferences = ['Museums', 'Local Food', 'Architecture']
</script>
