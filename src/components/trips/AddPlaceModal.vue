<template>
  <Teleport to="body">
    <div class="add-place-modal-overlay" role="presentation" @click.self="close">
      <section class="add-place-modal" role="dialog" aria-modal="true" aria-label="新增地點">
        <header class="add-place-modal__header">
          <div>
            <h3>新增地點</h3>
            <p class="add-place-modal__subtitle">到{{ columnTitle }}</p>
          </div>
          <button type="button" class="add-place-modal__close" aria-label="關閉" @click="close">
            <AppIcon name="close" :size="13" />
          </button>
        </header>

        <div class="add-place-modal__section">
          <BaseInput v-model="search" icon="search" placeholder="搜尋建議地點..." />
          <div class="add-place-modal__pills">
            <button
              type="button"
              class="preference-chip"
              :class="{ 'preference-chip--selected': activeCategory === 'all' }"
              @click="activeCategory = 'all'"
            >
              全部
            </button>
            <button
              v-for="category in availableCategories"
              :key="category"
              type="button"
              class="preference-chip"
              :class="{ 'preference-chip--selected': activeCategory === category }"
              @click="activeCategory = category"
            >
              {{ categoryLabel(category) }}
            </button>
          </div>
        </div>

        <div class="add-place-modal__suggestions">
          <button
            v-for="suggestion in filteredSuggestions"
            :key="suggestion.name"
            type="button"
            class="add-place-suggestion"
            @click="pickSuggestion(suggestion)"
          >
            <CategoryChip :category="suggestion.category" />
            <span class="add-place-suggestion__body">
              <strong>{{ suggestion.name }}</strong>
              <small>{{ suggestion.description }}</small>
            </span>
            <AppIcon name="plus" :size="14" />
          </button>

          <p v-if="filteredSuggestions.length === 0" class="add-place-modal__empty">
            沒有符合的建議地點，請用下方的自訂地點表單新增。
          </p>
        </div>

        <div class="add-place-modal__section add-place-custom">
          <span class="add-place-modal__label">自訂地點</span>
          <BaseInput v-model="customName" placeholder="地點名稱" />
          <div class="add-place-modal__pills">
            <button
              v-for="category in availableCategories"
              :key="category"
              type="button"
              class="preference-chip"
              :class="{ 'preference-chip--selected': customCategory === category }"
              @click="customCategory = category"
            >
              {{ categoryLabel(category) }}
            </button>
          </div>
          <BaseButton size="sm" :disabled="!customName.trim()" @click="addCustom">
            <AppIcon name="plus" :size="13" />
            新增自訂地點
          </BaseButton>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { suggestedPlacesForCity } from '../../data/generateTrip'
import type { PlaceCategory } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseButton from '../ui/BaseButton.vue'
import BaseInput from '../ui/BaseInput.vue'
import CategoryChip, { categoryLabels } from './CategoryChip.vue'

const props = defineProps<{
  columnId: string
  columnTitle: string
  city: string
  existingNames: string[]
}>()

const emit = defineEmits<{
  close: []
  add: [payload: { columnId: string; name: string; category: PlaceCategory; description: string }]
}>()

function categoryLabel(category: PlaceCategory) {
  return categoryLabels[category]
}

const search = ref('')
const activeCategory = ref<PlaceCategory | 'all'>('all')
const customName = ref('')
const customCategory = ref<PlaceCategory>('activity')

const suggestions = computed(() => suggestedPlacesForCity(props.city))
const availableCategories = computed(() => {
  const seen = new Set<PlaceCategory>()
  for (const suggestion of suggestions.value) seen.add(suggestion.category)
  return Array.from(seen)
})

const filteredSuggestions = computed(() => {
  const query = search.value.trim().toLowerCase()

  return suggestions.value.filter((suggestion) => {
    if (props.existingNames.includes(suggestion.name)) return false
    if (activeCategory.value !== 'all' && suggestion.category !== activeCategory.value) return false
    if (query && !suggestion.name.toLowerCase().includes(query)) return false
    return true
  })
})

function pickSuggestion(suggestion: { category: PlaceCategory; name: string; description: string }) {
  emit('add', { columnId: props.columnId, ...suggestion })
}

function addCustom() {
  const name = customName.value.trim()
  if (!name) return

  emit('add', {
    columnId: props.columnId,
    name,
    category: customCategory.value,
    description: `已加入行程，可以到側邊欄補充更多細節。`,
  })
  customName.value = ''
}

function close() {
  emit('close')
}
</script>
