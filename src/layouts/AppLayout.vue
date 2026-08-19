<template>
  <div v-if="isBare" class="bare-shell">
    <RouterView />
  </div>

  <div v-else class="workspace-shell" :class="{ 'workspace-shell--no-topbar': hideMobileTopBar }">
    <AppSidebar />
    <MobileTopBar v-if="!hideMobileTopBar" />

    <main ref="mainEl" class="workspace-shell__main">
      <RouterView />
    </main>

    <MobileBottomNav />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import MobileBottomNav from '../components/layout/MobileBottomNav.vue'
import MobileTopBar from '../components/layout/MobileTopBar.vue'

const route = useRoute()
// No AppSidebar/MobileTopBar chrome at all — for standalone flows (the
// guest-entry landing page, onboarding) that want to be distraction-free.
const isBare = computed(() => route.meta.layout === 'bare')
// Some workspace pages (e.g. trip-board) carry enough of their own header
// context that the generic branded top bar is redundant on mobile.
const hideMobileTopBar = computed(() => route.meta.hideMobileTopBar === true)

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
