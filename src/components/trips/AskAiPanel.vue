<template>
  <button
    v-if="!isMobile || !isOpen"
    type="button"
    class="ask-ai-launcher"
    :class="{ 'ask-ai-launcher--open': isOpen }"
    :aria-expanded="isOpen"
    aria-label="詢問 AI 調整行程"
    @click="toggleOpen"
  >
    <AppIcon :name="isOpen ? 'close' : 'chat-sparkle'" :size="isMobile ? 19 : 17" />
    <span v-if="!isMobile">{{ isOpen ? '關閉' : '問問 AI' }}</span>
  </button>

  <Transition name="mobile-sheet-fade">
    <button
      v-if="isOpen && isMobile"
      class="ask-ai-overlay"
      type="button"
      aria-label="關閉 AI 助手面板"
      @click="closePanel"
    />
  </Transition>

  <Transition :name="isMobile ? 'ask-ai-sheet-slide' : 'ask-ai-panel-slide'">
    <section
      v-if="isOpen"
      class="ask-ai-panel"
      :class="{ 'ask-ai-panel--sheet': isMobile }"
      aria-label="詢問 AI 調整行程"
    >
      <header class="ask-ai-panel__header">
        <span class="ask-ai-panel__title">
          <AppIcon name="sparkle" :size="14" />
          問 AI 幫你調整
        </span>
        <button type="button" class="ask-ai-panel__close" aria-label="關閉面板" @click="closePanel">
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
            {{ message.resolved === 'applied' ? '已套用' : '已略過' }}
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
          placeholder="例如：把博物館搬到第 1 天..."
          aria-label="傳送訊息給 AI"
        />
        <button type="submit" class="ask-ai-panel__send" :disabled="!draft.trim()" aria-label="送出訊息">
          <AppIcon name="arrow-right" :size="15" />
        </button>
      </form>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { useIsMobile } from '../../composables/useIsMobile'
import type { AskAiColumnSummary, AskAiResult } from '../../data/askAiClient'
import { fetchAskAiResult } from '../../data/askAiClient'
import type { PlaceSuggestion } from '../../data/generateTrip'
import { useTripsStore } from '../../stores/trips'
import type { Place, TripColumn } from '../../types'
import AppIcon from '../ui/AppIcon.vue'

// Shown while waiting for the AI reply (or the keyword-mock fallback) so a
// near-instant fallback doesn't flash the typing indicator on and off.
const MIN_THINKING_MS = 500

const props = defineProps<{
  tripId: string
}>()

const emit = defineEmits<{
  applied: [columnId: string]
}>()

type AiActionVariant = 'primary' | 'secondary'
type AiAction = { label: string; variant: AiActionVariant }
type AiIntent =
  | { type: 'move'; placeId: string; toColumnId: string }
  | { type: 'remove'; placeId: string }
  | { type: 'add'; columnId: string; places: PlaceSuggestion[] }
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
    { label: '套用變更', variant: 'primary' },
    { label: '先不要', variant: 'secondary' },
  ]
}

// Seeds the panel's opening demo conversation and doubles as the fallback
// heuristic in buildAiResponse() below when the real AI call in
// sendMessage() fails — keyword/regex matching, not a language model.
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
    text: `第 ${suggestion.fromColumn.dayNumber} 天有 ${suggestion.fromColumn.placeIds.length} 個景點——我會把「${suggestion.place.name}」搬到第 ${suggestion.toColumn.dayNumber} 天，那天只有 ${suggestion.toColumn.placeIds.length} 個景點。要套用這個變更嗎？`,
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
    text: '我可以幫你調整行程順序、更換地點，或調整節奏。你想改什麼呢？',
  },
  {
    id: nanoid(),
    role: 'user',
    text: '這天感覺排太滿了，可以幫我分散一下嗎？',
  },
  initialSuggestion
    ? { id: nanoid(), role: 'ai', ...rebalanceMessage(initialSuggestion) }
    : { id: nanoid(), role: 'ai', text: '你的行程天數已經很平均了，安排得不錯！' },
])

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

  if (intent.type === 'add') {
    for (const place of intent.places) {
      tripsStore.addPlace({
        tripId: props.tripId,
        columnId: intent.columnId,
        name: place.name,
        category: place.category,
        description: place.description,
        travelTip: place.travelTip,
        geocodeQuery: place.geocodeQuery,
      })
    }
    emit('applied', intent.columnId)
    return
  }

  tripsStore.removePlace(intent.placeId)
}

function resolveSuggestion(message: AiMessage, action: AiAction) {
  message.resolved = action.variant === 'primary' ? 'applied' : 'dismissed'
  if (action.variant !== 'primary' || !message.intent) return

  applyIntent(message.intent)
  messages.value.push({ id: nanoid(), role: 'ai', text: '完成，已經更新你的行程了。' })
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
    if (!toColumn) return { text: `這個行程沒有找到第 ${dayNumber} 天。` }
    if (toColumn.id === mentionedPlace.columnId) return { text: `「${mentionedPlace.name}」已經在第 ${dayNumber} 天了。` }

    return {
      text: `好的，我會把「${mentionedPlace.name}」搬到第 ${dayNumber} 天。要套用這個變更嗎？`,
      actions: suggestionActions(),
      intent: { type: 'move', placeId: mentionedPlace.id, toColumnId: toColumn.id },
    }
  }

  if (mentionedPlace && /remove|delete|刪除|移除/.test(lower)) {
    return {
      text: `我會把「${mentionedPlace.name}」從行程中移除。要套用這個變更嗎？`,
      actions: suggestionActions(),
      intent: { type: 'remove', placeId: mentionedPlace.id },
    }
  }

  if (/pack|busy|太趕|太滿|太多/.test(lower)) {
    const suggestion = computeRebalanceSuggestion()
    return suggestion ? rebalanceMessage(suggestion) : { text: '我看你的行程天數已經很平均了！' }
  }

  return { text: '了解，我會把這個納入你的行程考量。' }
}

function buildColumnSummaries(): AskAiColumnSummary[] {
  return (activeTrip.value?.columns ?? []).map((column) => ({
    id: column.id,
    dayNumber: column.dayNumber,
    title: column.title,
    places: column.placeIds
      .map((placeId) => tripPlaces.value.find((place) => place.id === placeId))
      .filter((place): place is Place => Boolean(place))
      .map((place) => ({ id: place.id, name: place.name, category: place.category })),
  }))
}

function messageFromAskAiResult(result: AskAiResult): Omit<AiMessage, 'id' | 'role'> {
  if (result.type === 'text') return { text: result.text }

  if (result.type === 'move_place') {
    return {
      text: result.message,
      actions: suggestionActions(),
      intent: { type: 'move', placeId: result.placeId, toColumnId: result.toColumnId },
    }
  }

  if (result.type === 'remove_place') {
    return {
      text: result.message,
      actions: suggestionActions(),
      intent: { type: 'remove', placeId: result.placeId },
    }
  }

  // The confirmation sentence is built entirely here, not from a Claude-
  // generated message — that was inconsistent about whether it actually
  // named the places, so the user couldn't always tell what "套用變更" would
  // do. Building it from `places` guarantees the names show up exactly once.
  const column = activeTrip.value?.columns.find((item) => item.id === result.columnId)
  const dayLabel = column ? `第 ${column.dayNumber} 天` : '這一天'
  const placeNames = result.places.map((place) => `「${place.name}」`).join('、')
  return {
    text: `我已爲${dayLabel}推薦了 ${result.places.length} 個景點：${placeNames}。你可以選擇是否加入行程，或告訴我你想要其他類型的景點！`,
    actions: suggestionActions(),
    intent: { type: 'add', columnId: result.columnId, places: result.places },
  }
}

async function sendMessage() {
  const text = draft.value.trim()
  if (!text) return

  messages.value.push({ id: nanoid(), role: 'user', text })
  draft.value = ''
  scrollToBottom()

  isThinking.value = true
  const [result] = await Promise.all([
    fetchAskAiResult(text, activeTrip.value?.destination ?? '', buildColumnSummaries()),
    new Promise((resolve) => window.setTimeout(resolve, MIN_THINKING_MS)),
  ])
  isThinking.value = false

  const reply = result ? messageFromAskAiResult(result) : buildAiResponse(text)
  messages.value.push({ id: nanoid(), role: 'ai', ...reply })
  scrollToBottom()
}

watch(isOpen, (open) => {
  if (open) scrollToBottom()
})
</script>
