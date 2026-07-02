<template>
  <div v-if="isMarketing" class="marketing-shell">
    <AppHeader />

    <main>
      <RouterView />
    </main>
  </div>

  <div v-else class="workspace-shell">
    <AppSidebar />

    <main class="workspace-shell__main">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '../components/layout/AppHeader.vue'
import AppSidebar from '../components/layout/AppSidebar.vue'

const route = useRoute()
const isMarketing = computed(() => route.meta.layout === 'marketing')
</script>
