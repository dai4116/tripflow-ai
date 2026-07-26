<template>
  <section class="trips-page">
    <PageHeader
      title="我的行程"
      description="瀏覽你規劃中的所有行程。"
    >
    </PageHeader>

    <div v-if="trips.length === 0" class="trips-empty">
      <AppIcon name="compass" :size="28" />
      <h3>還沒有任何行程</h3>
      <p>建立你的第一趟旅程，開始規劃景點與行程安排</p>
      <BaseButton :to="{ name: 'trip-create' }" variant="primary">建立行程</BaseButton>
    </div>

    <div v-else class="trips-list">
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
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
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
    message: '這個行程及裡面所有的地點都會一併刪除，刪除後無法復原喔。',
    confirmLabel: '刪除',
    danger: true,
    onConfirm: () => tripsStore.removeTrip(trip.id),
  })
}
</script>
