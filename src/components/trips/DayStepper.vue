<template>
  <div class="day-stepper">
    <button
      type="button"
      class="day-stepper__button"
      :class="{ 'day-stepper__button--labeled': showLabels }"
      aria-label="新增一天"
      @click="emit('add')"
    >
      <AppIcon name="plus" :size="13" />
      <span v-if="showLabels">新增天數</span>
    </button>
    <button
      type="button"
      class="day-stepper__button day-stepper__button--remove"
      :class="{ 'day-stepper__button--labeled': showLabels }"
      aria-label="刪除天數"
      aria-haspopup="menu"
      :aria-expanded="isMenuOpen"
      :disabled="columns.length <= 1"
      @click="isMenuOpen = !isMenuOpen"
    >
      <AppIcon name="minus" :size="13" />
      <span v-if="showLabels">刪除天數</span>
    </button>

    <DayPickerSheet
      v-if="isMenuOpen"
      :columns="columns"
      title="請選擇要刪除的天數"
      @select="selectDelete"
    />
    <button
      v-if="isMenuOpen"
      type="button"
      class="day-stepper__delete-backdrop"
      aria-label="關閉刪除選單"
      @click="isMenuOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { TripColumn } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import DayPickerSheet from './DayPickerSheet.vue'

defineProps<{
  columns: TripColumn[]
  // Icon-only fits the tight mobile day-tab strip; the desktop header has
  // room to spell out what + / - actually do.
  showLabels?: boolean
}>()

const emit = defineEmits<{
  add: []
  delete: [columnId: string]
}>()

const isMenuOpen = ref(false)

function selectDelete(columnId: string) {
  isMenuOpen.value = false
  emit('delete', columnId)
}
</script>
