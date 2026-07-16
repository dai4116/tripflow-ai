import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint}px)`
  const isMobile = ref(typeof window !== 'undefined' ? window.matchMedia(query).matches : false)
  let mediaQuery: MediaQueryList | null = null

  function updateIsMobile(event: MediaQueryListEvent) {
    isMobile.value = event.matches
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(query)
    isMobile.value = mediaQuery.matches
    mediaQuery.addEventListener('change', updateIsMobile)
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', updateIsMobile)
  })

  return isMobile
}
