<template>
  <span class="category-chip" :class="`category-chip--${category}`">
    <AppIcon :name="categoryIcon" :size="11" />
    {{ categoryLabel }}
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
  food: 'Food',
  cafe: 'Cafe',
  shopping: 'Shopping',
  culture: 'Culture',
  nature: 'Nature',
  museum: 'Museum',
  transport: 'Transport',
  stay: 'Stay',
  activity: 'Activity',
  other: 'Other',
}

export const allPlaceCategories = Object.keys(categoryLabels) as PlaceCategory[]
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlaceCategory as PlaceCategoryProp } from '../../types'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{
  category: PlaceCategoryProp
}>()

const categoryIcon = computed(() => categoryIcons[props.category])
const categoryLabel = computed(() => categoryLabels[props.category])
</script>
