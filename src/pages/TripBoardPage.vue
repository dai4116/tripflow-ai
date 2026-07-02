<template>
  <section class="trip-board-page">
    <PageHeader
      :title="activeTrip.title"
      :description="`${activeTrip.destination} · ${activeTrip.dateRange} · ${activeTrip.travelers} travelers · ${activeTrip.budget} budget`"
    >
      <template #badge>
        <StatusBadge tone="success">{{ activeTrip.status }}</StatusBadge>
      </template>
      <template #actions>
        <BaseButton variant="secondary" size="sm">Filter</BaseButton>
        <BaseButton variant="secondary" size="sm">＋ Add place</BaseButton>
      </template>
    </PageHeader>

    <div class="board-workspace">
      <div class="kanban-board" aria-label="Tokyo Explorer board">
        <section
          v-for="column in activeTrip.columns"
          :key="column.id"
          class="kanban-column"
        >
          <header class="kanban-column__header">
            <span>{{ column.title }}</span>
            <span class="kanban-column__count">{{ column.placeIds.length }}</span>
          </header>

          <PlaceCard
            v-for="place in getColumnPlaces(column.placeIds)"
            :key="place.id"
            :place="place"
          />
        </section>
      </div>

      <aside class="map-panel" aria-label="Static map preview">
        <div class="map-panel__header">
          <strong>Map view</strong>
          <span>{{ places.length }} places</span>
        </div>
        <div class="map-panel__canvas">
          <span
            v-for="(place, index) in places"
            :key="place.id"
            class="map-dot"
            :style="markerPosition(index)"
            :title="place.name"
          />
        </div>
        <div class="map-panel__legend">
          <span>Culture</span>
          <span>Food</span>
          <span>Nature</span>
          <span>Shopping</span>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import PageHeader from '../components/layout/PageHeader.vue'
import PlaceCard from '../components/trips/PlaceCard.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { places } from '../data/mockPlaces'
import { activeTrip } from '../data/mockTrips'

function getColumnPlaces(placeIds: string[]) {
  return placeIds
    .map((placeId) => places.find((place) => place.id === placeId))
    .filter((place) => place !== undefined)
}

function markerPosition(index: number) {
  const positions = [
    ['20%', '32%'],
    ['28%', '62%'],
    ['38%', '52%'],
    ['44%', '74%'],
    ['56%', '40%'],
    ['64%', '58%'],
    ['72%', '34%'],
    ['22%', '72%'],
    ['82%', '48%'],
    ['16%', '54%'],
    ['76%', '68%'],
    ['34%', '30%'],
  ]
  const [top, left] = positions[index] ?? ['50%', '50%']

  return { top, left }
}
</script>
