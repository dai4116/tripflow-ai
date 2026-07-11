<template>
  <RouterLink
    v-if="to"
    class="base-button"
    :class="classes"
    :to="to"
    :aria-disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <slot />
  </RouterLink>
  <button
    v-else
    class="base-button"
    :class="classes"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    to?: RouteLocationRaw
    disabled?: boolean
    loading?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
  },
)

const classes = computed(() => [
  `base-button--${props.variant}`,
  `base-button--${props.size}`,
  {
    'base-button--disabled': props.disabled,
    'base-button--loading': props.loading,
  },
])
</script>
