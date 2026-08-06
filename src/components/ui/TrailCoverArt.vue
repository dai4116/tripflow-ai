<template>
  <svg
    class="trail-cover-art"
    viewBox="0 0 400 200"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="skyId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#dcf7f2" />
        <stop offset="1" stop-color="#f5f8f8" />
      </linearGradient>
    </defs>
    <rect width="400" height="200" :fill="`url(#${skyId})`" />
    <path d="M40,86 q6,-9 12,0 q6,-9 12,0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7" />
    <path d="M64,102 q5,-7 10,0 q5,-7 10,0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.55" />
    <path d="M0,132 C70,96 150,150 230,112 C300,82 350,118 400,100 L400,200 L0,200 Z" fill="#00c5ab" opacity="0.45" />
    <path d="M0,168 C90,132 170,190 250,150 C320,120 360,158 400,138 L400,200 L0,200 Z" fill="#00a794" />
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue'

// "Fresh Trail" motif — two-tone teal hills under a soft sky — shown
// wherever a trip has no real cover photo (see TripCard.vue/
// DashboardPage.vue/TripSettingsModal.vue). A per-instance gradient id (not
// a fixed literal) is required here specifically because this component
// renders many times on one page (a whole trip grid) — a fixed id would
// duplicate across instances, and which instance's gradient definition a
// given `url(#id)` resolves to is undefined when IDs collide.
const skyId = useId()
</script>

<style scoped>
.trail-cover-art {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
