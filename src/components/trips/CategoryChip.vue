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
  cafe: 'coffee',
  shopping: 'bag',
  culture: 'museum',
  nature: 'leaf',
  museum: 'museum',
  transport: 'train',
  stay: 'bed',
  activity: 'ticket',
  other: 'sparkle',
}

export const categoryLabels: Record<PlaceCategory, string> = {
  food: '美食',
  cafe: '咖啡廳',
  shopping: '購物',
  culture: '文化',
  nature: '自然',
  museum: '博物館',
  transport: '交通',
  stay: '住宿',
  activity: '活動',
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

const categoryIcon = computed(() => categoryIcons[props.category])
const categoryLabel = computed(() => categoryLabels[props.category])
</script>
