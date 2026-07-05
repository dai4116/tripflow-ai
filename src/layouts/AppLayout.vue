<template>
  <div v-if="isMarketing" class="marketing-shell">
    <AppHeader />

    <main>
      <RouterView />
    </main>
  </div>

  <div v-else class="workspace-shell">
    <AppSidebar />
    <MobileTopBar :title="mobileTitle" />

    <main class="workspace-shell__main">
      <RouterView />
    </main>

    <MobileBottomNav />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '../components/layout/AppHeader.vue'
import AppSidebar from '../components/layout/AppSidebar.vue'
import MobileBottomNav from '../components/layout/MobileBottomNav.vue'
import MobileTopBar from '../components/layout/MobileTopBar.vue'

const route = useRoute()
const isMarketing = computed(() => route.meta.layout === 'marketing')
const mobileTitle = computed(() => {
  if (route.name === 'dashboard') return 'Dashboard'
  if (route.name === 'trip-create') return 'New Trip'
  if (route.name === 'trip-board') return 'Tokyo Explorer'

  return 'TripFlow AI'
})
</script>
