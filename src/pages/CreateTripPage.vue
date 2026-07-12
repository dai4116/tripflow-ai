<template>
  <section class="new-trip-page">
    <PageHeader
      eyebrow="新增行程"
      title="規劃新行程 ✈️"
      description="填寫細節，AI 會幫你打造專屬行程。"
      :back-to="{ name: 'dashboard' }"
      back-label="返回首頁"
    />

    <form v-if="!isGenerating" class="trip-form" @submit.prevent="generateTrip">
      <BaseCard class="form-card">
        <BaseInput
          ref="destinationInputRef"
          v-model="form.destination"
          label="你想去哪裡？"
          placeholder="例如：東京，日本"
          icon="search"
          :error="destinationError"
        />
      </BaseCard>

      <BaseCard class="form-card">
        <h3>行程細節</h3>
        <BaseDateRangeInput label="旅遊日期" v-model:start="form.startDate" v-model:end="form.endDate" :error="dateRangeError" />
        <div class="form-grid">
          <BaseInput v-model="form.budget" label="預算（USD）" placeholder="3,000" icon="dollar" />
          <BaseInput v-model="form.travelers" label="旅伴人數" type="number" icon="users" :min="1" :max="12" />
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>旅遊風格</h3>
        <div class="choice-grid">
          <button
            v-for="style in travelStyles"
            :key="style"
            type="button"
            class="choice-pill"
            :class="{ 'choice-pill--selected': form.travelStyle === style }"
            :aria-pressed="form.travelStyle === style"
            @click="selectTravelStyle(style)"
          >
            <AppIcon :name="getStyleIcon(style)" :size="15" />
            {{ style }}
          </button>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <h3>興趣偏好</h3>
        <p class="form-card__hint">選擇你喜歡的類型</p>
        <div class="preference-list">
          <button
            v-for="preference in preferences"
            :key="preference"
            type="button"
            class="preference-chip"
            :class="{ 'preference-chip--selected': selectedPreferences.includes(preference) }"
            :aria-pressed="selectedPreferences.includes(preference)"
            @click="togglePreference(preference)"
          >
            <AppIcon
              v-if="selectedPreferences.includes(preference)"
              name="check"
              :size="11"
            />
            {{ preference }}
          </button>
        </div>
      </BaseCard>

      <BaseCard class="form-card">
        <BaseInput
          v-model="form.avoidPlaces"
          label="想避開的地方"
          multiline
          placeholder="例如：週末避開澀谷、跳過觀光客拉麵店..."
        />
      </BaseCard>

      <BaseButton class="trip-form__submit" type="submit">
        <AppIcon name="sparkle" :size="15" />
        用 AI 生成行程
      </BaseButton>
      <p class="trip-form__note">
        AI 會產生 7 天行程看板・精選地點・優化路線
      </p>
    </form>

    <BaseCard v-else class="form-card generating-card">
      <div class="generating">
        <span class="generating__badge">
          <AppIcon name="sparkle" :size="22" />
        </span>
        <h2 class="generating__title">正在為你打造 {{ cityLabel }} 行程</h2>
        <p class="generating__subtitle">通常只需要幾秒鐘…</p>

        <ol class="generating__stages">
          <li
            v-for="(stage, index) in stages"
            :key="stage"
            class="generating__stage"
            :class="{
              'generating__stage--done': index < currentStageIndex,
              'generating__stage--active': index === currentStageIndex,
            }"
          >
            <span class="generating__stage-icon">
              <AppIcon v-if="index < currentStageIndex" name="check" :size="11" />
              <span v-else-if="index === currentStageIndex" class="generating__spinner" />
            </span>
            {{ stage }}
          </li>
        </ol>
      </div>
    </BaseCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import BaseDateRangeInput from '../components/ui/BaseDateRangeInput.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import type { IconName } from '../components/ui/icons'
import { preferences, travelStyles } from '../data/mockPreferences'
import { useTripsStore } from '../stores/trips'

const STAGE_DURATION = 550

const router = useRouter()
const tripsStore = useTripsStore()
const isGenerating = ref(false)
const currentStageIndex = ref(0)
const destinationError = ref('')
const dateRangeError = ref('')
const destinationInputRef = ref<InstanceType<typeof BaseInput> | null>(null)
const selectedPreferences = ref(['博物館', '在地美食', '建築'])

// YYYY-MM-DD in local time — Date#toISOString() is UTC and can land on the
// wrong calendar day depending on the visitor's timezone offset.
function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const defaultStart = new Date()
const defaultEnd = new Date()
defaultEnd.setDate(defaultEnd.getDate() + 7)

const form = reactive({
  destination: '',
  startDate: toDateInputValue(defaultStart),
  endDate: toDateInputValue(defaultEnd),
  budget: '',
  travelers: '2',
  travelStyle: '文化',
  avoidPlaces: '',
})

// Clear each error as soon as its own field is actually fixed, rather than
// only on the next full submit — otherwise a red border can sit there
// looking wrong even after the user has already typed a valid value.
watch(
  () => form.destination,
  (value) => {
    if (value.trim()) destinationError.value = ''
  },
)

watch(
  [() => form.startDate, () => form.endDate],
  ([start, end]) => {
    if (start && end && new Date(end).getTime() > new Date(start).getTime()) {
      dateRangeError.value = ''
    }
  },
)

const cityLabel = computed(() => form.destination.split(/[,，]/)[0].trim() || '你的')
const stages = computed(() => [
  '讀取你的偏好設定',
  `搜尋${cityLabel.value}的景點`,
  '規劃每日行程',
  '優化路線',
])

let stageTimer: number | undefined

function selectTravelStyle(style: string) {
  form.travelStyle = style
}

function togglePreference(preference: string) {
  if (selectedPreferences.value.includes(preference)) {
    selectedPreferences.value = selectedPreferences.value.filter((item) => item !== preference)
    return
  }

  selectedPreferences.value = [...selectedPreferences.value, preference]
}

function getStyleIcon(style: string): IconName {
  const icons: Record<string, IconName> = {
    冒險: 'mountain',
    放鬆: 'coffee',
    文化: 'museum',
    美食: 'cutlery',
    攝影: 'camera',
    自然: 'leaf',
  }

  return icons[style] ?? 'sparkle'
}

function generateTrip() {
  if (isGenerating.value) return

  if (!form.destination.trim()) {
    destinationError.value = '請先告訴我們你要去哪裡。'
    destinationInputRef.value?.focus()
    return
  }

  if (!form.startDate || !form.endDate) {
    dateRangeError.value = '請選擇旅遊日期。'
    return
  }

  if (new Date(form.endDate).getTime() <= new Date(form.startDate).getTime()) {
    dateRangeError.value = '結束日期必須晚於開始日期。'
    return
  }

  destinationError.value = ''
  dateRangeError.value = ''
  isGenerating.value = true
  currentStageIndex.value = 0
  advanceStage()
}

function advanceStage() {
  stageTimer = window.setTimeout(() => {
    currentStageIndex.value += 1
    if (currentStageIndex.value >= stages.value.length) {
      finishGeneration()
    } else {
      advanceStage()
    }
  }, STAGE_DURATION)
}

function finishGeneration() {
  const trip = tripsStore.createTrip({
    destination: form.destination.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    budget: form.budget,
    travelers: Number(form.travelers) || 1,
    travelStyle: form.travelStyle,
    avoidPlaces: form.avoidPlaces,
    preferences: selectedPreferences.value,
  })
  router.push({ name: 'trip-board', params: { tripId: trip.id }, query: { fresh: '1' } })
}

onBeforeUnmount(() => {
  if (stageTimer) {
    window.clearTimeout(stageTimer)
  }
})
</script>
