<template>
  <div v-if="isMarketing" class="marketing-shell">
    <AppHeader />

    <main>
      <RouterView />
    </main>
  </div>

  <div v-else class="workspace-shell">
    <AppSidebar />
    <MobileTopBar />

    <main ref="mainEl" class="workspace-shell__main">
      <RouterView />
    </main>

    <MobileBottomNav />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '../components/layout/AppHeader.vue'
import AppSidebar from '../components/layout/AppSidebar.vue'
import MobileBottomNav from '../components/layout/MobileBottomNav.vue'
import MobileTopBar from '../components/layout/MobileTopBar.vue'

const route = useRoute()
const isMarketing = computed(() => route.meta.layout === 'marketing')

// On mobile, .workspace-shell__main (not the document) is the scroll
// container — vue-router's own scrollBehavior only resets window scroll, so
// without this a route change would leave the new page's content wherever
// the previous page had been scrolled to.
const mainEl = ref<HTMLElement | null>(null)
watch(
  () => route.path,
  () => {
    if (mainEl.value) mainEl.value.scrollTop = 0
  },
)
</script>
