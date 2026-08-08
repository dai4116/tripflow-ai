<template>
  <BaseCard class="trip-card">
    <div class="trip-card__media" :style="{ background: showFallbackArt ? undefined : trip.imageGradient }">
      <img
        v-if="coverPhotoUrl"
        class="trip-card__media-photo"
        :src="coverPhotoUrl"
        alt=""
        loading="lazy"
        @error="onCoverPhotoError"
      />
      <img
        v-else-if="coverImageUrl"
        class="trip-card__media-photo"
        :src="coverImageUrl"
        alt=""
        loading="lazy"
        @error="onCoverImageError"
      />
      <TrailCoverArt v-else-if="showFallbackArt" class="trip-card__media-fallback" />
      <button
        v-if="deletable"
        type="button"
        class="trip-card__delete"
        :aria-label="`刪除 ${trip.title}`"
        @click.stop.prevent="emit('delete')"
      >
        <AppIcon name="trash" :size="12" />
      </button>
      <div class="trip-card__title">
        <strong>{{ trip.title }}</strong>
        <small><AppIcon name="pin" :size="11" />{{ trip.destination }}</small>
        <small v-if="trip.dateRange"><AppIcon name="calendar" :size="11" />{{ trip.dateRange }}</small>
      </div>
    </div>

    <div class="trip-card__body">
      <div class="trip-card__meta">
        <span><AppIcon name="calendar" :size="12" />{{ trip.days }} 天</span>
        <span><AppIcon name="pin" :size="12" />{{ trip.placeCount }}</span>
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useCoverPhotoUrl } from '../../composables/useCoverPhotoUrl'
import { useImageWithFallback } from '../../composables/useImageWithFallback'
import type { TripSummary } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseCard from '../ui/BaseCard.vue'
import TrailCoverArt from '../ui/TrailCoverArt.vue'

const props = defineProps<{
  // dateRange/imageGradient are optional here (not part of TripSummary)
  // because this card also renders Explore templates — imageGradient only
  // exists on ExploreTemplate, absent (and unused) on a real Trip.
  // coverImage/coverPhotoRef are both on TripSummary itself (a copied
  // template trip keeps its coverImage — see copyTemplateTrip).
  trip: TripSummary & { dateRange?: string; imageGradient?: string }
  deletable?: boolean
  // Explore templates keep their own curated per-template gradient (see
  // exploreTrips.ts) rather than this generic illustration — real trips
  // (TripsPage.vue) opt in, template cards (DashboardPage.vue's explore
  // grid) don't pass this at all.
  showFallbackArt?: boolean
}>()

const emit = defineEmits<{
  delete: []
}>()

// .trip-grid/.trips-list columns are minmax(220px, 1fr) with no upper cap
// (see global.scss), so this card can render far wider than its 220px
// minimum on a large screen — 400 left the photo visibly soft once
// upscaled to fill a wider card, let alone at 2x retina. 900 stays under
// api/place-photo.ts's own 1000 cap while comfortably covering realistic
// card widths at 2x.
const { url: coverPhotoUrl, onError: onCoverPhotoError } = useCoverPhotoUrl(
  computed(() => props.trip.coverPhotoRef),
  900,
)
const { url: coverImageUrl, onError: onCoverImageError } = useImageWithFallback(
  computed(() => props.trip.coverImage),
)
</script>
