import assert from 'node:assert/strict'
import test from 'node:test'

import { useConfirmDialog } from './useConfirmDialog.ts'

test('starts closed', () => {
  const { confirmDialog } = useConfirmDialog()
  assert.equal(confirmDialog.open, false)
})

test('openConfirm applies defaults for confirmLabel and danger when omitted', () => {
  const { confirmDialog, openConfirm } = useConfirmDialog()
  openConfirm({ title: '刪除地點', message: '確定要刪除嗎？', onConfirm: () => {} })
  assert.equal(confirmDialog.open, true)
  assert.equal(confirmDialog.title, '刪除地點')
  assert.equal(confirmDialog.confirmLabel, '確認')
  assert.equal(confirmDialog.danger, false)
})

test('openConfirm honors an explicit confirmLabel and danger', () => {
  const { confirmDialog, openConfirm } = useConfirmDialog()
  openConfirm({ title: '刪除', message: 'm', confirmLabel: '刪除', danger: true, onConfirm: () => {} })
  assert.equal(confirmDialog.confirmLabel, '刪除')
  assert.equal(confirmDialog.danger, true)
})

test('closeConfirm closes without calling onConfirm', () => {
  let called = false
  const { confirmDialog, openConfirm, closeConfirm } = useConfirmDialog()
  openConfirm({ title: 't', message: 'm', onConfirm: () => { called = true } })
  closeConfirm()
  assert.equal(confirmDialog.open, false)
  assert.equal(confirmDialog.onConfirm, null)
  assert.equal(called, false)
})

test('acceptConfirm calls onConfirm and then closes', () => {
  let called = false
  const { confirmDialog, openConfirm, acceptConfirm } = useConfirmDialog()
  openConfirm({ title: 't', message: 'm', onConfirm: () => { called = true } })
  acceptConfirm()
  assert.equal(called, true)
  assert.equal(confirmDialog.open, false)
})
