<template>
  <section class="trips-page">
    <PageHeader
      eyebrow="Workspace"
      title="My trips"
      description="Browse every trip in your planning workspace."
    >
      <template v-if="!isMobile" #actions>
        <BaseButton :to="{ name: 'trip-create' }">
          <AppIcon name="plus" :size="14" />
          New trip
        </BaseButton>
      </template>
    </PageHeader>

    <div class="trips-list">
      <RouterLink
        v-for="trip in trips"
        :key="trip.id"
        :to="{ name: 'trip-board', params: { tripId: trip.id } }"
      >
        <TripCard :trip="trip" />
      </RouterLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import PageHeader from '../components/layout/PageHeader.vue'
import TripCard from '../components/trips/TripCard.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import { useIsMobile } from '../composables/useIsMobile'
import { useTripsStore } from '../stores/trips'

const isMobile = useIsMobile()
const { trips } = storeToRefs(useTripsStore())
</script>
