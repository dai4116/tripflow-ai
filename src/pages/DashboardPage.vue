<template>
  <section class="dashboard-page">
    <PageHeader
      :eyebrow="todayLabel"
      :title="greetingTitle"
      :description="greetingDescription"
    />

    <section v-if="spotlightTrip" class="dashboard-section">
      <div class="section-head">
        <h2>{{ upcomingTrip ? '即將到來的旅程' : '上次的旅程' }}</h2>
      </div>

      <RouterLink class="upcoming-trip" :to="{ name: 'trip-board', params: { tripId: spotlightTrip.id } }">
        <div class="upcoming-trip__media">
          <img
            v-if="spotlightCoverPhotoUrl"
            class="upcoming-trip__media-photo"
            :src="spotlightCoverPhotoUrl"
            alt=""
            @error="onSpotlightCoverPhotoError"
          />
          <img
            v-else-if="spotlightCoverImageUrl"
            class="upcoming-trip__media-photo"
            :src="spotlightCoverImageUrl"
            alt=""
            @error="onSpotlightCoverImageError"
          />
          <TrailCoverArt v-else class="upcoming-trip__media-fallback" />
          <span class="upcoming-trip__countdown">{{ spotlightStatusLabel }}</span>
        </div>
        <div class="upcoming-trip__body">
          <h3>{{ spotlightTrip.title }}</h3>
          <p class="upcoming-trip__meta">
            <AppIcon name="pin" :size="13" />{{ spotlightTrip.destination }}
            <span class="upcoming-trip__dot">·</span>
            {{ spotlightTrip.dateRange }}
          </p>
          <div class="upcoming-trip__stats">
            <span><AppIcon name="calendar" :size="13" />{{ spotlightTrip.days }} 天</span>
            <span><AppIcon name="pin" :size="13" />{{ spotlightTrip.placeCount }} 個地點</span>
          </div>
        </div>
        <span class="upcoming-trip__cta">
          {{ upcomingTrip ? '查看行程' : '回顧行程' }}
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
import TrailCoverArt from '../components/ui/TrailCoverArt.vue'
import { useCoverPhotoUrl } from '../composables/useCoverPhotoUrl'
import { useImageWithFallback } from '../composables/useImageWithFallback'
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
// Matches the daypart the eyebrow's real date already reflects, instead of
// a greeting that's stuck on "早安" no matter when the page is opened.
const greetingTitle = computed(() => {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚上好'
  return `${greeting}，柏翰！👋`
})
const greetingDescription = computed(() => {
  if (trips.value.length === 0) return '開始規劃你的第一趟旅程吧'

  return `有 ${trips.value.length} 個行程進行中`
})

// Whole-day difference, ignoring time-of-day, so "today" still counts as 0
// rather than a small negative number depending on the current hour.
//
// dateStr is a plain "YYYY-MM-DD" — new Date(dateStr) would parse that as
// UTC midnight per spec, then .setHours(0,0,0,0) re-reads it in the
// viewer's *local* time, silently shifting it back a day for anyone west of
// UTC. Building the Date from its numeric parts instead always constructs
// in local time, so there's no UTC/local mismatch to correct for.
function daysUntil(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Templates copied via copyTemplateTrip() have no startDate ('尚未安排日期'),
// so they naturally fall out of this — only trips with a real, upcoming
// start date are eligible for the spotlight.
const upcomingTrip = computed(() => {
  const upcoming = trips.value
    .filter((trip): trip is Trip & { startDate: string } => Boolean(trip.startDate))
    .map((trip) => ({ trip, days: daysUntil(trip.startDate) }))
    .filter(({ days }) => days >= 0)
    .sort((a, b) => a.days - b.days)

  return upcoming[0]?.trip ?? null
})

// Shown instead when every trip's start date has already passed — picks
// whichever one started most recently rather than the oldest, so a
// returning user with no upcoming trip still lands on something relevant
// instead of the section just disappearing.
const lastTrip = computed(() => {
  if (upcomingTrip.value) return null

  const past = trips.value
    .filter((trip): trip is Trip & { startDate: string } => Boolean(trip.startDate))
    .map((trip) => ({ trip, days: daysUntil(trip.startDate) }))
    .filter(({ days }) => days < 0)
    .sort((a, b) => b.days - a.days)

  return past[0]?.trip ?? null
})

const spotlightTrip = computed(() => upcomingTrip.value ?? lastTrip.value)

const spotlightStatusLabel = computed(() => {
  if (!spotlightTrip.value?.startDate) return ''

  const days = daysUntil(spotlightTrip.value.startDate)
  if (days >= 0) {
    if (days === 0) return '今天出發'
    if (days === 1) return '明天出發'
    return `${days} 天後出發`
  }

  const daysSince = -days
  if (daysSince === 1) return '昨天出發'
  return `${daysSince} 天前出發`
})

const { url: spotlightCoverPhotoUrl, onError: onSpotlightCoverPhotoError } = useCoverPhotoUrl(
  computed(() => spotlightTrip.value?.coverPhotoRef),
  440,
)
const { url: spotlightCoverImageUrl, onError: onSpotlightCoverImageError } = useImageWithFallback(
  computed(() => spotlightTrip.value?.coverImage),
)
</script>
