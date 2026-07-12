<template>
  <aside class="app-sidebar">
    <RouterLink class="app-sidebar__brand" :to="{ name: 'landing' }">
      <span class="brand-mark"><AppIcon name="compass" :size="18" /></span>
      <span>TripFlow AI</span>
    </RouterLink>

    <nav class="app-sidebar__section" aria-label="Workspace navigation">
      <p class="app-sidebar__label">Menu</p>
      <RouterLink :to="{ name: 'dashboard' }">
        <AppIcon name="grid" />
        <span>Dashboard</span>
      </RouterLink>
      <RouterLink :to="{ name: 'trips' }">
        <AppIcon name="list" />
        <span>Trips</span>
      </RouterLink>
      <RouterLink :to="{ name: 'trip-create' }">
        <AppIcon name="plus" />
        <span>New Trip</span>
      </RouterLink>
    </nav>

    <div class="app-sidebar__user">
      <span class="app-sidebar__avatar">AK</span>
      <div>
        <strong>Alex Kim</strong>
        <small>alex@tripflow.ai</small>
      </div>
      <AppIcon class="app-sidebar__settings" name="gear" :size="15" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
</script>
