import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useIsMobile(breakpoint = 768) {
  const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < breakpoint : false)

  function updateIsMobile() {
    isMobile.value = window.innerWidth < breakpoint
  }

  onMounted(() => {
    updateIsMobile()
    window.addEventListener('resize', updateIsMobile)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateIsMobile)
  })

  return isMobile
}
