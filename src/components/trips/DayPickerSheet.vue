<template>
  <div class="day-picker-sheet" :class="`day-picker-sheet--${direction}`" role="menu" :aria-label="title">
    <div class="day-picker-sheet__list">
      <button
        v-for="column in columns"
        :key="column.id"
        type="button"
        class="day-picker-sheet__item"
        role="menuitem"
        :disabled="column.id === disabledColumnId"
        @click="emit('select', column.id)"
      >
        {{ column.title }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TripColumn } from '../../types'

withDefaults(
  defineProps<{
    columns: TripColumn[]
    title: string
    // The one column selecting itself wouldn't make sense (e.g. moving a
    // place to the day it's already on) — greyed out and unclickable
    // rather than left off the list, so its position is still visible.
    disabledColumnId?: string
    // Which side of the trigger this opens toward, so it stays on-screen
    // regardless of where the trigger sits.
    direction?: 'above' | 'below'
  }>(),
  { direction: 'below' },
)

const emit = defineEmits<{
  select: [columnId: string]
}>()
</script>
