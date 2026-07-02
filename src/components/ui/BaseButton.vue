<template>
  <RouterLink
    v-if="to"
    class="base-button"
    :class="classes"
    :to="to"
  >
    <slot />
  </RouterLink>
  <button v-else class="base-button" :class="classes" :type="type">
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'accent'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    to?: RouteLocationRaw
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
  },
)

const classes = computed(() => [
  `base-button--${props.variant}`,
  `base-button--${props.size}`,
])
</script>
