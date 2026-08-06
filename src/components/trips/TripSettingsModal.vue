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

        <div class="trip-settings-modal__cover">
          <img
            v-if="coverPhotoUrl"
            class="trip-settings-modal__cover-photo"
            :src="coverPhotoUrl"
            alt=""
            @error="onCoverPhotoError"
          />
          <img
            v-else-if="coverImageUrl"
            class="trip-settings-modal__cover-photo"
            :src="coverImageUrl"
            alt=""
            @error="onCoverImageError"
          />
          <TrailCoverArt v-else class="trip-settings-modal__cover-fallback" />
          <div class="trip-settings-modal__cover-actions">
            <button
              v-if="coverPhotoRef"
              type="button"
              class="trip-settings-modal__cover-remove"
              @click="clearCoverPhoto"
            >
              移除封面照
            </button>
            <button
              ref="changeCoverButtonRef"
              type="button"
              class="trip-settings-modal__cover-change"
              :disabled="!trip.destinationPlaceId || pickerLoading"
              :title="trip.destinationPlaceId ? undefined : '此行程的目的地未經 Google 驗證，暫不支援自動帶入封面照'"
              @click="openPicker"
            >
              <AppIcon name="image" :size="13" />
              變更封面照
            </button>
          </div>
        </div>

        <div v-if="pickerOpen" class="trip-settings-modal__picker">
          <p v-if="pickerLoading" class="trip-settings-modal__picker-empty">載入中…</p>
          <p v-else-if="pickerFailed" class="trip-settings-modal__picker-empty">照片載入失敗，請稍後再試。</p>
          <p v-else-if="photoRefs.length === 0" class="trip-settings-modal__picker-empty">
            找不到這個目的地的照片
          </p>
          <div v-else class="trip-settings-modal__picker-grid">
            <button
              v-for="(photoRef, index) in photoRefs"
              :key="photoRef"
              type="button"
              class="trip-settings-modal__picker-thumb"
              :class="{ 'trip-settings-modal__picker-thumb--active': photoRef === coverPhotoRef }"
              :aria-label="`封面照選項 ${index + 1}`"
              :aria-pressed="photoRef === coverPhotoRef"
              @click="selectCoverPhoto(photoRef)"
            >
              <img v-if="!failedThumbRefs.has(photoRef)" :src="thumbUrl(photoRef)" alt="" @error="onThumbError(photoRef)" />
              <AppIcon v-else name="image" :size="14" />
            </button>
          </div>
        </div>

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
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCoverPhotoUrl } from '../../composables/useCoverPhotoUrl'
import { useImageWithFallback } from '../../composables/useImageWithFallback'
import { fetchTripCoverPhotoRefs } from '../../data/tripCoverPhotosClient'
import { toDateInputValue } from '../../data/generateTrip'
import type { Trip, TripSettingsSavePayload } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseButton from '../ui/BaseButton.vue'
import BaseCard from '../ui/BaseCard.vue'
import BaseDateRangeInput from '../ui/BaseDateRangeInput.vue'
import BaseInput from '../ui/BaseInput.vue'
import TrailCoverArt from '../ui/TrailCoverArt.vue'

const props = defineProps<{ trip: Trip }>()

const emit = defineEmits<{
  close: []
  save: [payload: TripSettingsSavePayload]
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

// The currently selected cover photo — starts at whatever the trip already
// has (possibly none), and only changes when the user actually picks a new
// one from the picker below (or removes it); nothing is written back until
// Save. Requested at 1000px (this modal's own cover is up to 560px CSS-wide —
// see .trip-settings-modal's width — so 1000 matches the 2x-DPI convention
// api/place-photo.ts's own MAX_WIDTH_PX comment documents elsewhere).
const coverPhotoRef = ref(props.trip.coverPhotoRef)
const { url: coverPhotoUrl, onError: onCoverPhotoError, reset: resetCoverPhotoFailed } = useCoverPhotoUrl(coverPhotoRef, 1000)
const { url: coverImageUrl, onError: onCoverImageError } = useImageWithFallback(
  computed(() => props.trip.coverImage),
)

// Picking a thumbnail or removing the cover photo both unmount the element
// the user just activated (the picker grid closes; the "移除封面照" button's
// own v-if goes false) — without moving focus somewhere else first, the
// browser drops it to <body>, disorienting keyboard/screen-reader users.
// "變更封面照" is the one control guaranteed to still be there afterward.
const changeCoverButtonRef = ref<HTMLButtonElement | null>(null)

function clearCoverPhoto() {
  coverPhotoRef.value = undefined
  changeCoverButtonRef.value?.focus()
}

function thumbUrl(photoRef: string): string {
  return `/api/place-photo?ref=${encodeURIComponent(photoRef)}&w=160`
}

// Per-thumbnail load failures in the picker grid — same reasoning as
// AddPlaceModal.vue's failedPhotoIds for its own search-result thumbnails.
const failedThumbRefs = ref(new Set<string>())
function onThumbError(photoRef: string) {
  failedThumbRefs.value.add(photoRef)
}

const pickerOpen = ref(false)
const pickerLoading = ref(false)
const pickerFailed = ref(false)
const photoRefs = ref<string[]>([])
// Candidates are fetched once per destinationPlaceId and kept — toggling the
// picker open/closed again in the same modal session shouldn't re-fire a
// billed Google Places call for a result that can't have changed.
let photosFetchedForPlaceId: string | undefined
let fetchController: AbortController | undefined

async function openPicker() {
  // Also guards against a rapid double-click re-entering while a fetch for
  // the earlier click is still in flight — without this, a second click
  // could abort-and-restart mid-fetch, and a fast-enough Google response can
  // already be billed before the abort reaches the server, billing twice for
  // one interaction. The template disables the button while pickerLoading is
  // true too; this is the non-UI-dependent backstop.
  if (!props.trip.destinationPlaceId || pickerLoading.value) return
  pickerOpen.value = !pickerOpen.value
  if (!pickerOpen.value || photosFetchedForPlaceId === props.trip.destinationPlaceId) return

  const controller = new AbortController()
  fetchController = controller

  pickerLoading.value = true
  pickerFailed.value = false
  const refs = await fetchTripCoverPhotoRefs(props.trip.destinationPlaceId, controller.signal)
  // Only reachable via onBeforeUnmount's abort below (the pickerLoading guard
  // above rules out any other path aborting a live fetch) — skips writing
  // state on a component that's already being torn down.
  if (controller.signal.aborted) return

  pickerLoading.value = false
  if (refs === undefined) {
    pickerFailed.value = true
    return
  }
  photoRefs.value = refs
  photosFetchedForPlaceId = props.trip.destinationPlaceId
}

function selectCoverPhoto(photoRef: string) {
  coverPhotoRef.value = photoRef
  // Re-picking the same photoRef (retrying one that already failed to load)
  // is a no-op assignment to Vue's ref setter, so the composable's own
  // reset-on-change watch wouldn't fire — reset explicitly instead.
  resetCoverPhotoFailed()
  pickerOpen.value = false
  changeCoverButtonRef.value?.focus()
}

onBeforeUnmount(() => fetchController?.abort())

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

  emit('save', { title: trimmedTitle, startDate: startDate.value, endDate: endDate.value, coverPhotoRef: coverPhotoRef.value })
}
</script>
