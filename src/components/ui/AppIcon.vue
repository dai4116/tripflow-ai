<template>
  <svg
    class="app-icon"
    :width="size"
    :height="icon.tall ? Math.round(size * 1.25) : size"
    :viewBox="icon.tall ? '0 0 24 30' : '0 0 24 24'"
    fill="none"
    aria-hidden="true"
    v-html="icon.body"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { icons } from './icons'
import type { IconName } from './icons'

const props = withDefaults(
  defineProps<{
    name: IconName
    size?: number
  }>(),
  {
    size: 16,
  },
)

const icon = computed(() => icons[props.name] as { body: string; tall?: boolean })
</script>

<style scoped>
.app-icon {
  display: inline-block;
  flex: none;
  vertical-align: -0.14em;
}
</style>
