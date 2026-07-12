<template>
  <section class="dashboard-page">
    <PageHeader
      eyebrow="週二・2025年3月11日"
      title="早安，柏翰！👋"
      description="有 3 個行程進行中——東京行程 4 天後出發。"
    />

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
        <h2>最近的行程</h2>
        <span class="section-head__count">{{ trips.length }}</span>
        <BaseButton :to="{ name: 'trips' }" variant="ghost" size="sm">查看全部 →</BaseButton>
      </div>

      <div class="trip-grid">
        <RouterLink
          v-for="trip in recentTrips"
          :key="trip.id"
          :to="{ name: 'trip-board', params: { tripId: trip.id } }"
        >
          <TripCard :trip="trip" />
        </RouterLink>
      </div>
    </section>

    <section class="cta-band">
      <div class="cta-band__copy">
        <h2>開始規劃你的下一場冒險 🌴</h2>
        <p>描述你的行程，AI 會自動產生看板、路線和預算。</p>
      </div>
      <BaseButton :to="{ name: 'trip-create' }" variant="accent">
        <AppIcon name="sparkle" :size="14" />
        建立行程
      </BaseButton>
    </section>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import PageHeader from '../components/layout/PageHeader.vue'
import TripCard from '../components/trips/TripCard.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import { stats } from '../data/mockStats'
import { useTripsStore } from '../stores/trips'

const { trips } = storeToRefs(useTripsStore())
// Trips have no createdAt field — newly created ones are simply pushed to
// the end of the array (see tripsStore.createTrip), so "recent" means the
// last few entries, newest first, matching the 4-column trip-grid exactly.
const recentTrips = computed(() => [...trips.value].slice(-4).reverse())
</script>
