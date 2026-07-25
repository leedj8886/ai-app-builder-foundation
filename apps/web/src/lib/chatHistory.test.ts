import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createChatHistoryState,
  failChatHistory,
  formatChatUpdatedAt,
  loadChatHistory,
  selectRecentChats,
} from './chatHistory'

const chats = Array.from({ length: 7 }, (_, index) => ({
  _id: String(index),
  title: `Chat ${index}`,
  preview: `Prompt ${index}`,
  createdAt: `2026-07-${String(25 - index).padStart(2, '0')}T10:00:00.000Z`,
  updatedAt: `2026-07-${String(25 - index).padStart(2, '0')}T11:00:00.000Z`,
}))

test('selects at most five recent Chats', () => {
  assert.deepEqual(
    selectRecentChats(chats).map((chat) => chat._id),
    ['0', '1', '2', '3', '4'],
  )
})

test('models loading ready and error states', () => {
  const loading = loadChatHistory(createChatHistoryState())
  assert.equal(loading.status, 'loading')
  const ready = loadChatHistory(loading, chats)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.chats.length, 7)
  const failed = failChatHistory(ready, 'Unable to load conversations')
  assert.equal(failed.status, 'error')
  assert.equal(failed.chats.length, 7)
})

test('formats same-day and older updated times', () => {
  const now = new Date('2026-07-25T12:00:00+08:00')
  assert.equal(
    formatChatUpdatedAt('2026-07-25T11:00:00+08:00', now, 'zh-CN'),
    '11:00',
  )
  assert.match(
    formatChatUpdatedAt('2026-07-20T11:00:00+08:00', now, 'zh-CN'),
    /7月20日/,
  )
})
