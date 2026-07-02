<template>
  <aside class="app-sidebar">
    <RouterLink class="app-sidebar__brand" :to="{ name: 'landing' }">
      <span class="brand-mark">✈</span>
      <span>TripFlow AI</span>
    </RouterLink>

    <nav class="app-sidebar__section" aria-label="Workspace navigation">
      <p class="app-sidebar__label">Menu</p>
      <RouterLink :to="{ name: 'dashboard' }">
        <span class="nav-icon">▦</span>
        <span>Dashboard</span>
      </RouterLink>
      <RouterLink :to="{ name: 'trip-board' }">
        <span class="nav-icon">▤</span>
        <span>Trip Board</span>
      </RouterLink>
      <RouterLink :to="{ name: 'trip-create' }">
        <span class="nav-icon">＋</span>
        <span>New Trip</span>
      </RouterLink>
    </nav>

    <div class="app-sidebar__section">
      <p class="app-sidebar__label">My Trips</p>
      <RouterLink
        v-for="trip in trips"
        :key="trip.id"
        class="app-sidebar__trip"
        :to="{ name: trip.id === 'tokyo-explorer' ? 'trip-board' : 'dashboard' }"
      >
        <span class="app-sidebar__trip-dot" :style="{ backgroundColor: trip.color }" />
        <span>{{ trip.title }}</span>
      </RouterLink>
    </div>

    <div class="app-sidebar__user">
      <span class="app-sidebar__avatar">AK</span>
      <div>
        <strong>Alex Kim</strong>
        <small>alex@tripflow.ai</small>
      </div>
      <span class="app-sidebar__settings">⚙</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { trips } from '../../data/mockTrips'
</script>
