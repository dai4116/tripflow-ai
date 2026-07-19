<template>
  <div class="mobile-day-tabs">
    <div class="mobile-day-tabs__row">
      <button
        v-for="column in columns"
        :key="column.id"
        :ref="(el) => setDayTabRef(column.id, el)"
        type="button"
        class="mobile-day-tabs__tab"
        :class="{ 'mobile-day-tabs__tab--active': focusedColumnId === column.id }"
        @click="emit('focus-column', column.id)"
      >
        {{ column.title }}
      </button>
    </div>
    <DayStepper v-if="editable" :columns="columns" @add="emit('add')" @delete="(columnId) => emit('delete', columnId)" />
  </div>
</template>

<script setup lang="ts">
// Shared by TripBoardPage.vue's mobile board view and TripMap.vue's map
// panel — they used to each keep their own copy of this tab strip, which is
// exactly how the map's copy ended up missing the DayStepper controls and
// scroll-into-view behavior the board's copy already had. One component now,
// so any future fix here reaches both call sites automatically.
import type { ComponentPublicInstance } from 'vue'
import { nextTick, watch } from 'vue'
import type { TripColumn } from '../../types'
import DayStepper from './DayStepper.vue'

const props = defineProps<{
  columns: TripColumn[]
  focusedColumnId: string
  // Explore templates are read-only (no day add/remove) — only the real trip
  // board opts in to showing the stepper here.
  editable?: boolean
}>()

const emit = defineEmits<{
  'focus-column': [columnId: string]
  add: []
  delete: [columnId: string]
}>()

const dayTabEls: Record<string, Element | null> = {}
function setDayTabRef(columnId: string, el: Element | ComponentPublicInstance | null) {
  dayTabEls[columnId] = el instanceof Element ? el : null
}

// Keeps the active tab reachable in this strip's own scroll area — e.g.
// adding a day focuses the new (possibly off-screen) column. immediate:true
// so a freshly-mounted strip (e.g. switching from board to map view on
// mobile) also scrolls to whatever's already focused, not just future
// changes — otherwise the initial focused tab can start off-screen with no
// indication which day is active.
watch(
  () => props.focusedColumnId,
  (columnId) => {
    nextTick(() => {
      dayTabEls[columnId]?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' })
    })
  },
  { immediate: true },
)
</script>
