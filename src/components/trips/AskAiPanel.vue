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
    <AppIcon :name="isOpen ? 'close' : 'sparkle'" :size="isMobile ? 17 : 15" />
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
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useIsMobile } from '../../composables/useIsMobile'
import AppIcon from '../ui/AppIcon.vue'

type AiActionVariant = 'primary' | 'secondary'
type AiAction = { label: string; variant: AiActionVariant }
type AiMessage = {
  id: string
  role: 'ai' | 'user'
  text: string
  actions?: AiAction[]
  resolved?: 'applied' | 'dismissed'
}

const isMobile = useIsMobile()
const isOpen = ref(false)
const isThinking = ref(false)
const draft = ref('')
const messagesEl = ref<HTMLElement | null>(null)

const messages = ref<AiMessage[]>([
  {
    id: nanoid(),
    role: 'ai',
    text: 'I can help you rearrange your trip, swap places, or adjust the pace. What would you like to change?',
  },
  {
    id: nanoid(),
    role: 'user',
    text: 'Day 2 feels too packed, can you spread it out?',
  },
  {
    id: nanoid(),
    role: 'ai',
    text: 'I\'d move "Harajuku Street" to Day 3 — that leaves Day 2 with 2 stops. Want me to apply this?',
    actions: [
      { label: 'Apply change', variant: 'primary' },
      { label: 'Not now', variant: 'secondary' },
    ],
  },
])

let thinkingTimer: number | undefined

function toggleOpen() {
  isOpen.value = !isOpen.value
}

function closePanel() {
  isOpen.value = false
}

function resolveSuggestion(message: AiMessage, action: AiAction) {
  message.resolved = action.variant === 'primary' ? 'applied' : 'dismissed'
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
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
    messages.value.push({
      id: nanoid(),
      role: 'ai',
      text: "Got it — I'll factor that into your itinerary.",
    })
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
