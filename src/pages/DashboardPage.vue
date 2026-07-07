<template>
  <section class="dashboard-page">
    <PageHeader
      eyebrow="Tue · Mar 11 2025"
      title="Good morning, Alex! 👋"
      description="3 trips in motion — Tokyo departs in 4 days."
    >
      <template v-if="!isMobile" #actions>
        <BaseButton :to="{ name: 'trip-create' }">
          <AppIcon name="plus" :size="14" />
          New trip
        </BaseButton>
      </template>
    </PageHeader>

    <div class="stats-grid">
      <BaseCard v-for="stat in stats" :key="stat.id" class="stat-card">
        <span class="stat-card__icon" :class="`stat-card__icon--${stat.tone}`">
          <AppIcon :name="stat.icon" :size="18" />
        </span>
        <small
          class="stat-card__delta"
          :class="`stat-card__delta--${stat.helperTone}`"
        >{{ stat.helper }}</small>
        <strong class="stat-card__value">{{ stat.value }}</strong>
        <span class="stat-card__label">{{ stat.label }}</span>
      </BaseCard>
    </div>

    <section class="dashboard-section">
      <div class="section-head">
        <h2>Recent trips</h2>
        <span class="section-head__count">{{ trips.length }}</span>
        <BaseButton variant="ghost" size="sm">View all →</BaseButton>
      </div>

      <div class="trip-grid">
        <RouterLink
          v-for="trip in trips"
          :key="trip.id"
          :to="{ name: 'trip-board', params: { tripId: trip.id } }"
        >
          <TripCard :trip="trip" />
        </RouterLink>
      </div>
    </section>

    <section class="cta-band">
      <div class="cta-band__copy">
        <h2>Start planning your next adventure 🌴</h2>
        <p>Describe the trip — AI drafts the board, the route, and the budget.</p>
      </div>
      <BaseButton :to="{ name: 'trip-create' }" variant="accent">
        <AppIcon name="sparkle" :size="14" />
        Create trip
      </BaseButton>
    </section>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import PageHeader from '../components/layout/PageHeader.vue'
import TripCard from '../components/trips/TripCard.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { stats } from '../data/mockStats'
import { useTripsStore } from '../stores/trips'

const isMobile = useIsMobile()
const { trips } = storeToRefs(useTripsStore())
</script>
