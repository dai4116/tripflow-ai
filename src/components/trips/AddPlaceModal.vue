<template>
  <Teleport to="body">
    <div class="add-place-modal-overlay" role="presentation" @click.self="close">
      <section class="add-place-modal" role="dialog" aria-modal="true" aria-label="Add a place">
        <header class="add-place-modal__header">
          <h3>Add a place</h3>
          <button type="button" class="add-place-modal__close" aria-label="Close" @click="close">
            <AppIcon name="close" :size="13" />
          </button>
        </header>

        <div class="add-place-modal__section">
          <span class="add-place-modal__label">Add to</span>
          <div class="add-place-modal__pills">
            <button
              v-for="column in columns"
              :key="column.id"
              type="button"
              class="preference-chip"
              :class="{ 'preference-chip--selected': selectedColumnId === column.id }"
              @click="selectedColumnId = column.id"
            >
              {{ column.title }}
            </button>
            <button
              type="button"
              class="add-place-modal__day-control"
              aria-label="Remove a day"
              :disabled="columns.length <= 1"
              @click="isRemoveDayMenuOpen = !isRemoveDayMenuOpen"
            >
              <AppIcon name="minus" :size="12" />
            </button>
            <div v-if="isRemoveDayMenuOpen" class="add-place-modal__day-remove-menu" role="menu">
              <p class="add-place-modal__day-remove-hint">請選擇要刪除的天數</p>
              <button
                v-for="column in columns"
                :key="column.id"
                type="button"
                class="add-place-modal__day-remove-option"
                role="menuitem"
                @click="confirmRemoveDay(column)"
              >
                {{ column.title }}
              </button>
            </div>
            <button
              v-if="isRemoveDayMenuOpen"
              class="add-place-modal__day-remove-backdrop"
              type="button"
              aria-label="Close"
              @click="isRemoveDayMenuOpen = false"
            />
            <button
              type="button"
              class="add-place-modal__day-control"
              aria-label="Add a day"
              @click="emit('add-day')"
            >
              <AppIcon name="plus" :size="12" />
            </button>
          </div>
        </div>

        <div class="add-place-modal__section">
          <BaseInput v-model="search" icon="search" placeholder="Search suggestions..." />
          <div class="add-place-modal__pills">
            <button
              type="button"
              class="preference-chip"
              :class="{ 'preference-chip--selected': activeCategory === 'all' }"
              @click="activeCategory = 'all'"
            >
              All
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
            No suggestions match — try the custom place form below.
          </p>
        </div>

        <div class="add-place-modal__section add-place-custom">
          <span class="add-place-modal__label">Custom place</span>
          <BaseInput v-model="customName" placeholder="Place name" />
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
            Add custom place
          </BaseButton>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { suggestedPlacesForCity } from '../../data/generateTrip'
import type { PlaceCategory, TripColumn } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseButton from '../ui/BaseButton.vue'
import BaseInput from '../ui/BaseInput.vue'
import CategoryChip, { categoryLabels } from './CategoryChip.vue'

const props = defineProps<{
  columns: TripColumn[]
  defaultColumnId: string
  city: string
  existingNames: string[]
}>()

const emit = defineEmits<{
  close: []
  add: [payload: { columnId: string; name: string; category: PlaceCategory; description: string }]
  'add-day': []
  'remove-day': [columnId: string]
}>()

function categoryLabel(category: PlaceCategory) {
  return categoryLabels[category]
}

const selectedColumnId = ref(props.defaultColumnId)
const search = ref('')
const activeCategory = ref<PlaceCategory | 'all'>('all')
const customName = ref('')
const customCategory = ref<PlaceCategory>('activity')
const isRemoveDayMenuOpen = ref(false)

// Adding a day is almost always so you can add a place to it — jump the
// selection there instead of leaving it on whatever day was picked before.
// Removing a day can also knock out whatever was selected, so fall back to
// the first remaining day rather than emitting an add against a dead id.
watch(
  () => props.columns,
  (columns, previousColumns) => {
    if (columns.length > previousColumns.length) {
      selectedColumnId.value = columns[columns.length - 1].id
    } else if (!columns.some((column) => column.id === selectedColumnId.value)) {
      selectedColumnId.value = columns[0]?.id ?? ''
    }
  },
)

function confirmRemoveDay(column: TripColumn) {
  isRemoveDayMenuOpen.value = false
  const confirmed = window.confirm(`要刪除第 ${column.dayNumber} 天及這天所有行程嗎？\n刪除後無法復原喔`)
  if (confirmed) emit('remove-day', column.id)
}

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
  emit('add', { columnId: selectedColumnId.value, ...suggestion })
}

function addCustom() {
  const name = customName.value.trim()
  if (!name) return

  emit('add', {
    columnId: selectedColumnId.value,
    name,
    category: customCategory.value,
    description: `Added to your trip — fill in more details from the drawer.`,
  })
  customName.value = ''
}

function close() {
  emit('close')
}
</script>
