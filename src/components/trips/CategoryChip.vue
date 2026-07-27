<template>
  <span
    class="category-chip"
    :class="[`category-chip--${category}`, { 'category-chip--icon-only': iconOnly }]"
    :aria-label="iconOnly ? categoryLabel : undefined"
  >
    <AppIcon :name="categoryIcon" :size="iconOnly ? 14 : 11" />
    <template v-if="!iconOnly">{{ categoryLabel }}</template>
  </span>
</template>

<script lang="ts">
import type { PlaceCategory } from '../../types'
import type { IconName } from '../ui/icons'

export const categoryIcons: Record<PlaceCategory, IconName> = {
  food: 'cutlery',
  attraction: 'camera',
  shopping: 'bag',
  stay: 'bed',
  transport: 'train',
  other: 'sparkle',
}

export const categoryLabels: Record<PlaceCategory, string> = {
  food: '美食',
  attraction: '景點',
  shopping: '購物',
  stay: '住宿',
  transport: '交通',
  other: '其他',
}

export const allPlaceCategories = Object.keys(categoryLabels) as PlaceCategory[]
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlaceCategory as PlaceCategoryProp } from '../../types'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  category: PlaceCategoryProp
  iconOnly?: boolean
}>()

// `?? categoryIcons.other` / `?? categoryLabels.other` guards a category
// value TypeScript can't actually verify at this boundary — `props.category`
// ultimately traces back to an AI response cast to PlaceSuggestion[] with no
// runtime enum check (see aiTripClient.ts), so a schema-drift or version-skew
// value outside the current 6 would otherwise be `undefined` here and crash
// AppIcon's template reading `.body` off it.
const categoryIcon = computed(() => categoryIcons[props.category] ?? categoryIcons.other)
const categoryLabel = computed(() => categoryLabels[props.category] ?? categoryLabels.other)
</script>
