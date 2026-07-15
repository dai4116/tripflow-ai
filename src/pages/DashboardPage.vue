<template>
  <section class="dashboard-page">
    <PageHeader
      :eyebrow="todayLabel"
      title="早安，柏翰！👋"
      :description="greetingDescription"
    />

    <section v-if="upcomingTrip" class="dashboard-section">
      <div class="section-head">
        <h2>即將到來的旅程</h2>
      </div>

      <RouterLink class="upcoming-trip" :to="{ name: 'trip-board', params: { tripId: upcomingTrip.id } }">
        <div class="upcoming-trip__media" :style="{ background: upcomingTrip.imageGradient }">
          <span class="upcoming-trip__countdown">{{ countdownLabel }}</span>
        </div>
        <div class="upcoming-trip__body">
          <h3>{{ upcomingTrip.title }}</h3>
          <p class="upcoming-trip__meta">
            <AppIcon name="pin" :size="13" />{{ upcomingTrip.destination }}
            <span class="upcoming-trip__dot">·</span>
            {{ upcomingTrip.dateRange }}
          </p>
          <div class="upcoming-trip__stats">
            <span><AppIcon name="calendar" :size="13" />{{ upcomingTrip.days }} 天</span>
            <span><AppIcon name="users" :size="13" />{{ upcomingTrip.travelers }} 位旅伴</span>
            <span><AppIcon name="pin" :size="13" />{{ upcomingTrip.placeCount }} 個地點</span>
          </div>
        </div>
        <span class="upcoming-trip__cta">
          繼續規劃
          <AppIcon name="arrow-right" :size="14" />
        </span>
      </RouterLink>
    </section>

    <section class="dashboard-section">
      <div class="section-head">
        <h2>探索行程</h2>
      </div>

      <div class="trip-grid">
        <RouterLink
          v-for="template in exploreTemplates"
          :key="template.id"
          :to="{ name: 'explore-trip', params: { templateId: template.id } }"
        >
          <TripCard :trip="template" />
        </RouterLink>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import PageHeader from '../components/layout/PageHeader.vue'
import TripCard from '../components/trips/TripCard.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import { exploreTemplates } from '../data/exploreTrips'
import { useTripsStore } from '../stores/trips'
import type { Trip } from '../types'

const { trips } = storeToRefs(useTripsStore())
// Header eyebrow shows the current date, e.g. "週日・2026年7月12日" — matches
// the project's native toLocaleDateString('zh-TW') convention (no dayjs).
const todayLabel = computed(() => {
  const now = new Date()
  const weekday = now.toLocaleDateString('zh-TW', { weekday: 'short' })
  const date = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
  return `${weekday}・${date}`
})
const greetingDescription = computed(() => {
  if (trips.value.length === 0) return '開始規劃你的第一趟旅程吧。'

  return `有 ${trips.value.length} 個行程進行中。`
})

// Whole-day difference, ignoring time-of-day, so "today" still counts as 0
// rather than a small negative number depending on the current hour.
function daysUntil(dateStr: string): number {
  const date = new Date(dateStr)
  date.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Templates copied via copyTemplateTrip() have no startDate ('尚未安排日期'),
// so they naturally fall out of this — only trips with a real, upcoming
// start date are eligible for the spotlight.
const upcomingTrip = computed(() => {
  const upcoming = trips.value
    .filter((trip): trip is Trip & { startDate: string } => Boolean(trip.startDate) && daysUntil(trip.startDate!) >= 0)
    .sort((a, b) => daysUntil(a.startDate) - daysUntil(b.startDate))

  return upcoming[0] ?? null
})

const countdownLabel = computed(() => {
  if (!upcomingTrip.value?.startDate) return ''

  const days = daysUntil(upcomingTrip.value.startDate)
  if (days === 0) return '今天出發'
  if (days === 1) return '明天出發'
  return `${days} 天後出發`
})
</script>
