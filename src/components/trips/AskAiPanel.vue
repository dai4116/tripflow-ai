<template>
  <button
    v-if="!isMobile || !isOpen"
    type="button"
    class="ask-ai-launcher"
    :class="{ 'ask-ai-launcher--open': isOpen }"
    :aria-expanded="isOpen"
    aria-label="Ask AI to adjust your itinerary"
    @click="toggleOpen"
  >
    <AppIcon :name="isOpen ? 'close' : 'chat-sparkle'" :size="isMobile ? 19 : 17" />
    <span v-if="!isMobile">{{ isOpen ? 'Close' : 'Ask AI' }}</span>
  </button>

  <Transition name="mobile-sheet-fade">
    <button
      v-if="isOpen && isMobile"
      class="ask-ai-overlay"
      type="button"
      aria-label="Close Ask AI panel"
      @click="closePanel"
    />
  </Transition>

  <Transition :name="isMobile ? 'ask-ai-sheet-slide' : 'ask-ai-panel-slide'">
    <section
      v-if="isOpen"
      class="ask-ai-panel"
      :class="{ 'ask-ai-panel--sheet': isMobile }"
      aria-label="Ask AI to adjust itinerary"
    >
      <header class="ask-ai-panel__header">
        <span class="ask-ai-panel__title">
          <AppIcon name="sparkle" :size="14" />
          Ask AI to adjust
        </span>
        <button type="button" class="ask-ai-panel__close" aria-label="Close panel" @click="closePanel">
          <AppIcon name="close" :size="13" />
        </button>
      </header>

      <div ref="messagesEl" class="ask-ai-panel__messages">
        <div
          v-for="message in messages"
          :key="message.id"
          class="ask-ai-message"
          :class="`ask-ai-message--${message.role}`"
        >
          <p class="ask-ai-message__text">{{ message.text }}</p>

          <div v-if="message.actions && !message.resolved" class="ask-ai-message__actions">
            <button
              v-for="action in message.actions"
              :key="action.label"
              type="button"
              class="ask-ai-message__action"
              :class="`ask-ai-message__action--${action.variant}`"
              @click="resolveSuggestion(message, action)"
            >
              {{ action.label }}
            </button>
          </div>

          <span v-else-if="message.resolved" class="ask-ai-message__resolved">
            <AppIcon v-if="message.resolved === 'applied'" name="check" :size="10" />
            {{ message.resolved === 'applied' ? 'Applied' : 'Dismissed' }}
          </span>
        </div>

        <div v-if="isThinking" class="ask-ai-message ask-ai-message--ai ask-ai-message--thinking">
          <span class="ask-ai-typing"><i /><i /><i /></span>
        </div>
      </div>

      <form class="ask-ai-panel__input" @submit.prevent="sendMessage">
        <input
          v-model="draft"
          type="text"
          placeholder="e.g. Move the museum to Day 1..."
          aria-label="Message to AI"
        />
        <button type="submit" class="ask-ai-panel__send" :disabled="!draft.trim()" aria-label="Send message">
          <AppIcon name="arrow-right" :size="15" />
        </button>
      </form>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useIsMobile } from '../../composables/useIsMobile'
import { useTripsStore } from '../../stores/trips'
import type { Place, TripColumn } from '../../types'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  tripId: string
}>()

const emit = defineEmits<{
  applied: [columnId: string]
}>()

type AiActionVariant = 'primary' | 'secondary'
type AiAction = { label: string; variant: AiActionVariant }
type AiIntent = { type: 'move'; placeId: string; toColumnId: string } | { type: 'remove'; placeId: string }
type AiMessage = {
  id: string
  role: 'ai' | 'user'
  text: string
  actions?: AiAction[]
  intent?: AiIntent
  resolved?: 'applied' | 'dismissed'
}

const isMobile = useIsMobile()
const isOpen = ref(false)
const isThinking = ref(false)
const draft = ref('')
const messagesEl = ref<HTMLElement | null>(null)

const tripsStore = useTripsStore()
const { trips, places } = storeToRefs(tripsStore)
const activeTrip = computed(() => trips.value.find((trip) => trip.id === props.tripId))
const tripPlaces = computed(() => places.value.filter((place) => place.tripId === props.tripId))

function suggestionActions(): AiAction[] {
  return [
    { label: 'Apply change', variant: 'primary' },
    { label: 'Not now', variant: 'secondary' },
  ]
}

// This is a mock: keyword/regex matching against the demo trip's own data,
// not a real language model. It's enough to make the panel feel alive and
// to prove out "chat edits the board" as a product idea.
function computeRebalanceSuggestion(): { place: Place; fromColumn: TripColumn; toColumn: TripColumn } | null {
  const columns = activeTrip.value?.columns ?? []
  if (columns.length < 2) return null

  const busiest = columns.reduce((max, column) => (column.placeIds.length > max.placeIds.length ? column : max), columns[0])
  const lightest = columns.reduce((min, column) => (column.placeIds.length < min.placeIds.length ? column : min), columns[0])

  // Only worth suggesting if there's a real imbalance and a place to move.
  if (busiest.id === lightest.id || busiest.placeIds.length - lightest.placeIds.length < 2) return null

  const placeId = busiest.placeIds[busiest.placeIds.length - 1]
  const place = tripPlaces.value.find((item) => item.id === placeId)
  if (!place) return null

  return { place, fromColumn: busiest, toColumn: lightest }
}

function rebalanceMessage(suggestion: { place: Place; fromColumn: TripColumn; toColumn: TripColumn }): Omit<AiMessage, 'id' | 'role'> {
  return {
    text: `Day ${suggestion.fromColumn.dayNumber} has ${suggestion.fromColumn.placeIds.length} stops — I'd move "${suggestion.place.name}" to Day ${suggestion.toColumn.dayNumber}, which only has ${suggestion.toColumn.placeIds.length}. Want me to apply this?`,
    actions: suggestionActions(),
    intent: { type: 'move', placeId: suggestion.place.id, toColumnId: suggestion.toColumn.id },
  }
}

function findMentionedPlace(text: string): Place | undefined {
  const lower = text.toLowerCase()
  return tripPlaces.value.find((place) => lower.includes(place.name.toLowerCase()))
}

function extractDayNumber(text: string): number | null {
  const match = text.match(/day\s*(\d+)/i) ?? text.match(/第\s*(\d+)\s*天/)
  const raw = match?.[1]
  const num = raw ? Number(raw) : NaN
  return Number.isFinite(num) ? num : null
}

const initialSuggestion = computeRebalanceSuggestion()
const messages = ref<AiMessage[]>([
  {
    id: nanoid(),
    role: 'ai',
    text: 'I can help you rearrange your trip, swap places, or adjust the pace. What would you like to change?',
  },
  {
    id: nanoid(),
    role: 'user',
    text: 'This day feels too packed, can you spread it out?',
  },
  initialSuggestion
    ? { id: nanoid(), role: 'ai', ...rebalanceMessage(initialSuggestion) }
    : { id: nanoid(), role: 'ai', text: 'Your days already look evenly balanced — nice work!' },
])

let thinkingTimer: number | undefined

function toggleOpen() {
  isOpen.value = !isOpen.value
}

function closePanel() {
  isOpen.value = false
}

function applyIntent(intent: AiIntent) {
  if (intent.type === 'move') {
    tripsStore.movePlaceToColumn(intent.placeId, intent.toColumnId)
    emit('applied', intent.toColumnId)
    return
  }

  tripsStore.removePlace(intent.placeId)
}

function resolveSuggestion(message: AiMessage, action: AiAction) {
  message.resolved = action.variant === 'primary' ? 'applied' : 'dismissed'
  if (action.variant !== 'primary' || !message.intent) return

  applyIntent(message.intent)
  messages.value.push({ id: nanoid(), role: 'ai', text: 'Done — updated your itinerary.' })
  scrollToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

// Keyword-matched demo intents, checked most-specific first: an explicit
// "move X to day N" beats a vague "too packed" so a message naming both a
// place and a day doesn't fall through to the generic rebalance heuristic.
function buildAiResponse(text: string): Omit<AiMessage, 'id' | 'role'> {
  const lower = text.toLowerCase()
  const mentionedPlace = findMentionedPlace(text)
  const dayNumber = extractDayNumber(text)

  if (mentionedPlace && dayNumber) {
    const toColumn = activeTrip.value?.columns.find((column) => column.dayNumber === dayNumber)
    if (!toColumn) return { text: `I couldn't find Day ${dayNumber} on this trip.` }
    if (toColumn.id === mentionedPlace.columnId) return { text: `"${mentionedPlace.name}" is already on Day ${dayNumber}.` }

    return {
      text: `Sure — I'll move "${mentionedPlace.name}" to Day ${dayNumber}. Want me to apply this?`,
      actions: suggestionActions(),
      intent: { type: 'move', placeId: mentionedPlace.id, toColumnId: toColumn.id },
    }
  }

  if (mentionedPlace && /remove|delete|刪除|移除/.test(lower)) {
    return {
      text: `I'll remove "${mentionedPlace.name}" from your trip. Want me to apply this?`,
      actions: suggestionActions(),
      intent: { type: 'remove', placeId: mentionedPlace.id },
    }
  }

  if (/pack|busy|太趕|太滿|太多/.test(lower)) {
    const suggestion = computeRebalanceSuggestion()
    return suggestion ? rebalanceMessage(suggestion) : { text: 'Your days already look evenly balanced to me!' }
  }

  return { text: "Got it — I'll factor that into your itinerary." }
}

function sendMessage() {
  const text = draft.value.trim()
  if (!text) return

  messages.value.push({ id: nanoid(), role: 'user', text })
  draft.value = ''
  scrollToBottom()

  isThinking.value = true
  thinkingTimer = window.setTimeout(() => {
    isThinking.value = false
    messages.value.push({ id: nanoid(), role: 'ai', ...buildAiResponse(text) })
    scrollToBottom()
  }, 900)
}

watch(isOpen, (open) => {
  if (open) scrollToBottom()
})

onBeforeUnmount(() => {
  if (thinkingTimer) window.clearTimeout(thinkingTimer)
})
</script>
