<template>
  <span class="category-chip" :class="`category-chip--${category}`">
    <AppIcon :name="categoryIcon" :size="11" />
    {{ categoryLabel }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlaceCategory } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import type { IconName } from '../ui/icons'

const props = defineProps<{
  category: PlaceCategory
}>()

const categoryIcons: Record<PlaceCategory, IconName> = {
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

const categoryLabels: Record<PlaceCategory, string> = {
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

const categoryIcon = computed(() => categoryIcons[props.category])
const categoryLabel = computed(() => categoryLabels[props.category])
</script>
