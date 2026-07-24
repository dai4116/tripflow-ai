<template>
  <Teleport to="body">
    <div class="trip-settings-modal-overlay" role="presentation" @click.self="close">
      <section class="trip-settings-modal" role="dialog" aria-modal="true" aria-label="行程設定">
        <header class="trip-settings-modal__header">
          <h3>行程設定</h3>
          <button type="button" class="trip-settings-modal__close" aria-label="關閉" @click="close">
            <AppIcon name="close" :size="13" />
          </button>
        </header>

        <div class="trip-settings-modal__cover" :style="{ background: trip.imageGradient }" />

        <form class="trip-settings-modal__form" @submit.prevent="handleSave">
          <div class="trip-settings-modal__body">
            <BaseCard class="form-card">
              <BaseInput
                ref="titleInputRef"
                v-model="title"
                label="行程名稱"
                placeholder="幫這趟旅程取個名字"
                :error="titleError"
              />
            </BaseCard>

            <BaseCard class="form-card">
              <BaseDateRangeInput label="行程日期" v-model:start="startDate" v-model:end="endDate" :error="dateRangeError" />
            </BaseCard>
          </div>

          <div class="trip-settings-modal__footer">
            <BaseButton variant="secondary" type="button" @click="close">取消</BaseButton>
            <BaseButton type="submit">儲存</BaseButton>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { toDateInputValue } from '../../data/generateTrip'
import type { Trip } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseButton from '../ui/BaseButton.vue'
import BaseCard from '../ui/BaseCard.vue'
import BaseDateRangeInput from '../ui/BaseDateRangeInput.vue'
import BaseInput from '../ui/BaseInput.vue'

const props = defineProps<{ trip: Trip }>()

const emit = defineEmits<{
  close: []
  save: [payload: { title: string; startDate: string; endDate: string }]
}>()

// Trips without a startDate yet (AI-generated ones, for now) default the
// picker to today rather than leaving it blank, so the range summary makes
// sense immediately instead of showing nothing until the user picks a date.
//
// `trip.days` counts inclusive calendar days (see computeTripDays in
// generateTrip.ts) — Mar 15 to Mar 22 is "8 days", both ends included. So
// the end date that reproduces it is startDate + (days - 1), the same
// offset columnDate uses for the last day-column's date.
const initialStart = props.trip.startDate ?? toDateInputValue(new Date())
const initialEnd = (() => {
  const end = new Date(initialStart)
  end.setDate(end.getDate() + Math.max(props.trip.days - 1, 0))
  return toDateInputValue(end)
})()

const title = ref(props.trip.title)
const startDate = ref(initialStart)
const endDate = ref(initialEnd)
const titleError = ref('')
const dateRangeError = ref('')
const titleInputRef = ref<InstanceType<typeof BaseInput> | null>(null)

watch(title, (value) => {
  if (value.trim()) titleError.value = ''
})

watch([startDate, endDate], ([start, end]) => {
  if (start && end && new Date(end).getTime() > new Date(start).getTime()) {
    dateRangeError.value = ''
  }
})

function close() {
  emit('close')
}

function handleSave() {
  const trimmedTitle = title.value.trim()
  if (!trimmedTitle) {
    titleError.value = '請輸入行程名稱。'
    titleInputRef.value?.focus()
    return
  }

  if (!startDate.value || !endDate.value) {
    dateRangeError.value = '請選擇旅遊日期。'
    return
  }

  if (new Date(endDate.value).getTime() <= new Date(startDate.value).getTime()) {
    dateRangeError.value = '結束日期必須晚於開始日期。'
    return
  }

  emit('save', { title: trimmedTitle, startDate: startDate.value, endDate: endDate.value })
}
</script>
