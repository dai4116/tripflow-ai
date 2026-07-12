<template>
  <section class="trips-page">
    <PageHeader
      eyebrow="工作區"
      title="我的行程"
      description="瀏覽你規劃中的所有行程。"
    >
    </PageHeader>

    <div class="trips-list">
      <RouterLink
        v-for="trip in trips"
        :key="trip.id"
        :to="{ name: 'trip-board', params: { tripId: trip.id } }"
      >
        <TripCard :trip="trip" deletable @delete="confirmDeleteTrip(trip)" />
      </RouterLink>
    </div>

    <ConfirmModal
      v-if="confirmDialog.open"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :confirm-label="confirmDialog.confirmLabel"
      :danger="confirmDialog.danger"
      @confirm="acceptConfirm"
      @cancel="closeConfirm"
    />
  </section>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import PageHeader from '../components/layout/PageHeader.vue'
import TripCard from '../components/trips/TripCard.vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useTripsStore } from '../stores/trips'
import type { TripSummary } from '../types'

const tripsStore = useTripsStore()
const { trips } = storeToRefs(tripsStore)
const { confirmDialog, openConfirm, closeConfirm, acceptConfirm } = useConfirmDialog()

function confirmDeleteTrip(trip: TripSummary) {
  openConfirm({
    title: `刪除「${trip.title}」？`,
    message: '這個行程及裡面所有的地點都會一併刪除，此動作無法復原。',
    confirmLabel: '刪除',
    danger: true,
    onConfirm: () => tripsStore.removeTrip(trip.id),
  })
}
</script>
