<template>
  <label ref="rootEl" class="base-field" :class="{ 'base-field--error': error }">
    <span v-if="label">{{ label }}</span>
    <div class="base-field__control destination-autocomplete__control">
      <AppIcon v-if="icon" :name="icon" :size="15" />
      <input
        ref="fieldEl"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="isOpen"
        :aria-controls="listboxId"
        :aria-activedescendant="activeOptionId"
        autocomplete="off"
        :placeholder="placeholder"
        :value="modelValue"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <ul v-if="isOpen" :id="listboxId" class="destination-autocomplete__suggestions" role="listbox">
        <li
          v-for="(suggestion, index) in suggestions"
          :id="`${listboxId}-option-${index}`"
          :key="suggestion.placeId"
          role="option"
          class="destination-autocomplete__option"
          :class="{ 'destination-autocomplete__option--active': index === highlightedIndex }"
          :aria-selected="index === highlightedIndex"
          @mousedown.prevent="selectSuggestion(suggestion)"
          @mouseenter="highlightedIndex = index"
        >
          <strong>{{ suggestion.mainText }}</strong>
          <small v-if="suggestion.secondaryText">{{ suggestion.secondaryText }}</small>
        </li>
      </ul>
    </div>
    <small v-if="error" class="base-field__error">{{ error }}</small>
  </label>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { autocompleteDestination, resolveDestinationPlace, type DestinationSuggestion } from '../../data/placesAutocompleteClient'
import AppIcon from '../ui/AppIcon.vue'
import type { IconName } from '../ui/icons'

const props = defineProps<{
  modelValue: string
  label?: string
  placeholder?: string
  icon?: IconName
  error?: string
  // True when the CURRENT modelValue already corresponds to a resolved
  // place, seeding lastSelectedLabel below on mount. Needed because this
  // component can remount with a non-blank modelValue that's already a
  // confirmed selection — e.g. CreateTripPage.vue's backToForm() (used on
  // a failed-generation retry) destroys and recreates this component via
  // v-if/v-else while its own form.destinationPlaceId/Lat/Lng persist. Without
  // this, the fresh instance's lastSelectedLabel would start at null despite
  // the text already being resolved, so editing it afterward would silently
  // fail to clear the parent's now-stale destinationPlaceId/Lat/Lng.
  resolved?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  // null clears a previously resolved place (typed text no longer matches
  // what was picked, or the field was cleared) — a picked suggestion whose
  // Details lookup fails also resolves to no `select` at all, leaving the
  // typed text as free text (see selectSuggestion).
  select: [payload: { placeId: string; lat: number; lng: number } | null]
}>()

// Keystrokes debounce like AddPlaceModal.vue's search (same 400ms, same
// abort-the-in-flight-request-on-a-newer-one pattern) — inlined here rather
// than a composable since this is the only consumer today.
const DEBOUNCE_MS = 400
let debounceTimer: number | undefined
let activeController: AbortController | null = null
// Separate from activeController above — that one only ever tracks the
// debounced autocomplete *search*; this tracks the terminal Place Details
// lookup a pick kicks off in selectSuggestion, which has its own lifecycle
// (started by a click/Enter, not a keystroke) and must be cancellable
// independently so a later edit or a different pick can invalidate it
// without touching an unrelated in-flight search.
let activeDetailsController: AbortController | null = null
// Bumped by invalidatePendingSelection() any time the field changes or a new
// suggestion is picked. selectSuggestion snapshots this before its await and
// checks it after — if a newer edit or pick already invalidated the pick this
// call is resolving, its (possibly stale, out-of-order) result is discarded
// instead of overwriting whatever the user has since done.
let selectionGeneration = 0

function invalidatePendingSelection() {
  selectionGeneration += 1
  activeDetailsController?.abort()
}

const rootEl = ref<HTMLLabelElement | null>(null)
const fieldEl = ref<HTMLInputElement | null>(null)
const suggestions = ref<DestinationSuggestion[]>([])
const isOpen = ref(false)
const highlightedIndex = ref(-1)
// Bundles every debounced keystroke request plus the terminal Details call
// into one Google-billed session; regenerated once that session closes (a
// selection resolves or fails) or the field is cleared, so the next attempt
// starts a fresh session rather than silently extending this one forever.
const sessionToken = ref(crypto.randomUUID())
// The exact string last confirmed via a resolved selection — lets
// handleValueChange (see onInput) notice the user edited past it and drop
// the now-stale placeId/lat/lng, instead of silently leaving them pointed at
// text that no longer matches. Seeded from `resolved` on mount (see its own
// comment) so this still works correctly right after a remount.
const lastSelectedLabel = ref<string | null>(props.resolved ? props.modelValue : null)

const listboxId = useId()
const activeOptionId = computed(() =>
  highlightedIndex.value >= 0 ? `${listboxId}-option-${highlightedIndex.value}` : undefined,
)

async function runSearch() {
  const query = props.modelValue.trim()
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller

  const results = await autocompleteDestination(query, sessionToken.value, controller.signal)
  if (controller.signal.aborted) return

  // undefined = the call failed outright (no route locally, key unset,
  // network error) — leave the dropdown closed with no error UI. This field
  // is an optional augmentation, not the primary way to fill it in, so a
  // silent degrade back to plain typing is the right behavior, not a visible
  // error message (see api/place-photo.ts's fallback-to-gradient for the
  // same "optional enhancement, never blocks the user" philosophy).
  if (results === undefined) {
    suggestions.value = []
    isOpen.value = false
    return
  }
  suggestions.value = results
  highlightedIndex.value = -1
  isOpen.value = results.length > 0
}

// Handles every side effect of the field's text changing for a real reason
// (the user typed) — called directly from onInput rather than via a
// watch(() => props.modelValue) round-trip through the parent. selectSuggestion
// below causes its own modelValue change too, but drives its own side effects
// directly instead of going through this path, so there's no need to infer
// "was this change self-caused" from the echoed-back prop value.
function handleValueChange(value: string) {
  invalidatePendingSelection()

  // The user edited past a confirmed selection (including clearing the
  // field entirely) — the previously resolved place no longer describes
  // what's typed, so drop it rather than let a stale placeId/lat/lng
  // silently survive an edit.
  if (lastSelectedLabel.value !== null && value !== lastSelectedLabel.value) {
    lastSelectedLabel.value = null
    emit('select', null)
  }

  window.clearTimeout(debounceTimer)
  activeController?.abort()

  if (!value.trim()) {
    suggestions.value = []
    isOpen.value = false
    highlightedIndex.value = -1
    sessionToken.value = crypto.randomUUID()
    return
  }
  debounceTimer = window.setTimeout(runSearch, DEBOUNCE_MS)
}

async function selectSuggestion(suggestion: DestinationSuggestion) {
  // Composes this app's own "City，Country" string rather than using
  // Google's raw suggestion text verbatim — matches the existing placeholder
  // (例如：東京，日本) and keeps cityFromDestination/regionFromDestination's
  // comma-split assumption valid for autocompleted destinations too.
  const label = suggestion.secondaryText ? `${suggestion.mainText}，${suggestion.secondaryText}` : suggestion.mainText
  const token = sessionToken.value

  // Invalidates (and aborts) any earlier pick's still-in-flight Details
  // resolution, then snapshots the resulting generation so THIS call can
  // later tell whether it's still the most recent one once its own await
  // settles — see invalidatePendingSelection's comment.
  invalidatePendingSelection()
  const generation = selectionGeneration

  window.clearTimeout(debounceTimer)
  activeController?.abort()
  suggestions.value = []
  isOpen.value = false
  highlightedIndex.value = -1

  lastSelectedLabel.value = null
  emit('update:modelValue', label)
  emit('select', null)

  const controller = new AbortController()
  activeDetailsController = controller
  const point = await resolveDestinationPlace(suggestion.placeId, token, controller.signal)

  // A newer pick or edit superseded this one while the Details call was in
  // flight — the component (and the parent's form) has already moved on to
  // something else, so this (possibly stale, out-of-order) result must be
  // discarded rather than silently overwriting whatever's current now.
  if (generation !== selectionGeneration) return

  // A session ends once its terminal Details call completes, successfully or
  // not — start fresh for whatever the user does next.
  sessionToken.value = crypto.randomUUID()

  if (!point) {
    console.warn('resolveDestinationPlace failed for', suggestion.placeId)
    return
  }
  lastSelectedLabel.value = label
  emit('select', { placeId: suggestion.placeId, lat: point.lat, lng: point.lng })
}

function onInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
  handleValueChange(value)
}

function onKeydown(event: KeyboardEvent) {
  // Enter (and in some IMEs, arrow keys) also fires while an IME composition
  // is still in progress (typing Chinese/Japanese via pinyin/zhuyin) — the
  // keystroke that CONFIRMS the composition must reach the IME untouched, not
  // get hijacked into selecting a dropdown suggestion out from under it.
  if (event.isComposing) return
  if (event.key === 'ArrowDown') {
    if (!isOpen.value || suggestions.value.length === 0) return
    event.preventDefault()
    highlightedIndex.value = (highlightedIndex.value + 1) % suggestions.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    if (!isOpen.value || suggestions.value.length === 0) return
    event.preventDefault()
    highlightedIndex.value = highlightedIndex.value <= 0 ? suggestions.value.length - 1 : highlightedIndex.value - 1
    return
  }
  if (event.key === 'Enter') {
    if (!isOpen.value) return
    if (highlightedIndex.value >= 0) {
      event.preventDefault()
      selectSuggestion(suggestions.value[highlightedIndex.value])
    } else if (suggestions.value.length === 1) {
      event.preventDefault()
      selectSuggestion(suggestions.value[0])
    }
    // Multiple suggestions, none highlighted: don't intercept — Enter falls
    // through to the surrounding form's native submit, so typed-but-not-
    // picked text still works exactly like a plain text field.
    return
  }
  if (event.key === 'Escape') {
    if (!isOpen.value) return
    event.preventDefault()
    isOpen.value = false
  }
}

// Only cancels the debounced *search* — a Details lookup already kicked off
// by an actual pick (selectSuggestion) is a real decision the user made, not
// a speculative keystroke, and should still resolve even if focus moves on.
function onBlur() {
  window.clearTimeout(debounceTimer)
  activeController?.abort()
  isOpen.value = false
}

onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer)
  activeController?.abort()
  activeDetailsController?.abort()
})

// Same contract as BaseInput.focus() — CreateTripPage.vue's validation calls
// this on a blank-destination submit so the user lands right on the field.
function focus() {
  rootEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  fieldEl.value?.focus({ preventScroll: true })
}

defineExpose({ focus })
</script>
