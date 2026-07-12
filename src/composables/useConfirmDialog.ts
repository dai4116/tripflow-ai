import { reactive } from 'vue'

// Shared state + handlers for a single ConfirmModal instance — pairs with
// <ConfirmModal v-if="confirmDialog.open" ... @confirm="acceptConfirm" @cancel="closeConfirm" />
export function useConfirmDialog() {
  const confirmDialog = reactive<{
    open: boolean
    title: string
    message: string
    confirmLabel: string
    danger: boolean
    onConfirm: (() => void) | null
  }>({
    open: false,
    title: '',
    message: '',
    confirmLabel: '確認',
    danger: false,
    onConfirm: null,
  })

  function openConfirm(options: { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void }) {
    confirmDialog.open = true
    confirmDialog.title = options.title
    confirmDialog.message = options.message
    confirmDialog.confirmLabel = options.confirmLabel ?? '確認'
    confirmDialog.danger = options.danger ?? false
    confirmDialog.onConfirm = options.onConfirm
  }

  function closeConfirm() {
    confirmDialog.open = false
    confirmDialog.onConfirm = null
  }

  function acceptConfirm() {
    confirmDialog.onConfirm?.()
    closeConfirm()
  }

  return { confirmDialog, openConfirm, closeConfirm, acceptConfirm }
}
