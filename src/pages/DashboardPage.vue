<template>
  <section class="dashboard-page">
    <PageHeader
      title="Good morning, Alex 👋"
      description="Tuesday, March 11, 2025"
    >
      <template #actions>
        <BaseButton :to="{ name: 'trip-create' }">＋ New trip</BaseButton>
      </template>
    </PageHeader>

    <div class="stats-grid">
      <BaseCard v-for="stat in stats" :key="stat.id" class="stat-card">
        <div class="stat-card__top">
          <StatusBadge>{{ stat.icon }}</StatusBadge>
          <span>↗</span>
        </div>
        <strong>{{ stat.value }}</strong>
        <span>{{ stat.label }}</span>
        <small>{{ stat.helper }}</small>
      </BaseCard>
    </div>

    <section class="dashboard-section">
      <PageHeader title="Recent trips">
        <template #actions>
          <BaseButton variant="ghost" size="sm">View all</BaseButton>
        </template>
      </PageHeader>

      <div class="trip-grid">
        <RouterLink
          v-for="trip in trips"
          :key="trip.id"
          :to="{ name: trip.id === 'tokyo-explorer' ? 'trip-board' : 'dashboard' }"
        >
          <TripCard :trip="trip" />
        </RouterLink>
      </div>
    </section>

    <section class="cta-band">
      <div>
        <h2>Start planning your next adventure</h2>
        <p>Let AI build your perfect itinerary in seconds.</p>
      </div>
      <BaseButton :to="{ name: 'trip-create' }" variant="accent">✦ Create trip</BaseButton>
    </section>
  </section>
</template>

<script setup lang="ts">
import PageHeader from '../components/layout/PageHeader.vue'
import TripCard from '../components/trips/TripCard.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { stats } from '../data/mockStats'
import { trips } from '../data/mockTrips'
</script>
