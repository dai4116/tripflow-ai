<template>
  <Teleport to="body">
    <div class="time-picker-overlay" :style="popoverStyle" role="presentation">
      <section ref="sheetEl" class="time-picker-sheet" role="dialog" :aria-label="title">
        <h3 class="time-picker-sheet__title">{{ title }}</h3>

        <div class="time-picker-wheels">
          <div class="time-picker-wheels__highlight" aria-hidden="true" />

          <div ref="hourWheelEl" class="time-picker-wheel" @scroll="onScroll('hour')">
            <div class="time-picker-wheel__spacer" />
            <button
              v-for="hour in hourOptions"
              :key="hour"
              type="button"
              class="time-picker-wheel__item"
              :class="{ 'time-picker-wheel__item--selected': hour === selectedHour }"
              @click="selectHour(hour)"
            >
              {{ String(hour).padStart(2, '0') }}
            </button>
            <div class="time-picker-wheel__spacer" />
          </div>

          <div ref="minuteWheelEl" class="time-picker-wheel" @scroll="onScroll('minute')">
            <div class="time-picker-wheel__spacer" />
            <button
              v-for="minute in minuteOptions"
              :key="minute"
              type="button"
              class="time-picker-wheel__item"
              :class="{ 'time-picker-wheel__item--selected': minute === selectedMinute }"
              @click="selectMinute(minute)"
            >
              {{ String(minute).padStart(2, '0') }}
            </button>
            <div class="time-picker-wheel__spacer" />
          </div>
        </div>

        <BaseButton class="time-picker-sheet__confirm" @click="confirm">確定</BaseButton>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import BaseButton from './BaseButton.vue'

// Must match .time-picker-wheel__item height — the scroll position converts
// to a selected value via index = scrollTop / this.
const ITEM_HEIGHT = 28

const props = defineProps<{
  modelValue: string
  title: string
  anchorEl: HTMLElement | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  close: []
}>()

const hourOptions = Array.from({ length: 24 }, (_, i) => i)
const minuteOptions = Array.from({ length: 60 }, (_, i) => i)

const [initialHour, initialMinute] = props.modelValue.split(':').map(Number)
const selectedHour = ref(Number.isFinite(initialHour) ? initialHour : 0)
const selectedMinute = ref(Number.isFinite(initialMinute) ? initialMinute : 0)

const hourWheelEl = ref<HTMLElement | null>(null)
const minuteWheelEl = ref<HTMLElement | null>(null)
const sheetEl = ref<HTMLElement | null>(null)
const popoverStyle = ref<Record<string, string>>({ visibility: 'hidden' })
const opensAbove = ref(false)
let sheetResizeObserver: ResizeObserver | null = null

const POPOVER_GAP = 8
const VIEWPORT_MARGIN = 12

function updatePopoverPosition() {
  if (!props.anchorEl || !sheetEl.value) return

  const anchorRect = props.anchorEl.getBoundingClientRect()
  const sheetRect = sheetEl.value.getBoundingClientRect()
  const belowSpace = window.innerHeight - anchorRect.bottom - POPOVER_GAP - VIEWPORT_MARGIN
  opensAbove.value = belowSpace < sheetRect.height

  const viewportTop = opensAbove.value
    ? anchorRect.top - POPOVER_GAP - sheetRect.height
    : anchorRect.bottom + POPOVER_GAP
  const clampedTop = Math.min(
    Math.max(VIEWPORT_MARGIN, viewportTop),
    Math.max(VIEWPORT_MARGIN, window.innerHeight - sheetRect.height - VIEWPORT_MARGIN),
  )
  const clampedLeft = Math.min(
    Math.max(VIEWPORT_MARGIN, anchorRect.left + (anchorRect.width - sheetRect.width) / 2),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - sheetRect.width - VIEWPORT_MARGIN),
  )

  popoverStyle.value = {
    top: `${clampedTop + window.scrollY}px`,
    left: `${clampedLeft + window.scrollX}px`,
    visibility: 'visible',
  }
}

// The capture-phase window listener below also sees the hour/minute wheels'
// own scroll events (capture fires on the way down to any scrolling
// descendant, teleported or not) — skip those, since spinning a wheel never
// moves the anchor or the sheet itself.
function onWindowScroll(event: Event) {
  if (event.target instanceof Node && sheetEl.value?.contains(event.target)) return
  updatePopoverPosition()
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!(event.target instanceof Node)) return
  if (sheetEl.value?.contains(event.target) || props.anchorEl?.contains(event.target)) return
  emit('close')
}

function jumpTo(el: HTMLElement | null, value: number) {
  if (!el) return
  el.scrollTop = value * ITEM_HEIGHT
}

onMounted(() => {
  // Jump (not smooth-scroll) to the starting value — this is the sheet
  // opening at the right position, not a user-driven scroll.
  nextTick(() => {
    jumpTo(hourWheelEl.value, selectedHour.value)
    jumpTo(minuteWheelEl.value, selectedMinute.value)
    updatePopoverPosition()
  })
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', updatePopoverPosition)
  window.addEventListener('scroll', onWindowScroll, true)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  sheetResizeObserver = new ResizeObserver(updatePopoverPosition)
  if (sheetEl.value) sheetResizeObserver.observe(sheetEl.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updatePopoverPosition)
  window.removeEventListener('scroll', onWindowScroll, true)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  sheetResizeObserver?.disconnect()
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

// Fires continuously during a scroll/fling — cheap enough to just recompute
// the nearest index each time, so the highlighted number tracks the wheel
// in real time instead of only updating once it settles.
function onScroll(which: 'hour' | 'minute') {
  const el = which === 'hour' ? hourWheelEl.value : minuteWheelEl.value
  if (!el) return

  const index = Math.round(el.scrollTop / ITEM_HEIGHT)
  if (which === 'hour') {
    selectedHour.value = Math.min(23, Math.max(0, index))
  } else {
    selectedMinute.value = Math.min(59, Math.max(0, index))
  }
}

function selectHour(hour: number) {
  selectedHour.value = hour
  hourWheelEl.value?.scrollTo({ top: hour * ITEM_HEIGHT, behavior: 'smooth' })
}

function selectMinute(minute: number) {
  selectedMinute.value = minute
  minuteWheelEl.value?.scrollTo({ top: minute * ITEM_HEIGHT, behavior: 'smooth' })
}

function confirm() {
  const hh = String(selectedHour.value).padStart(2, '0')
  const mm = String(selectedMinute.value).padStart(2, '0')
  emit('update:modelValue', `${hh}:${mm}`)
  emit('close')
}
</script>
