import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createChatHistoryState,
  failChatHistory,
  formatChatUpdatedAt,
  getChatAccessibleName,
  isActiveChat,
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
  const now = new Date(2026, 6, 25, 12)
  const sameDay = new Date(2026, 6, 25, 11).toISOString()
  const older = new Date(2026, 6, 20, 11).toISOString()
  assert.equal(
    formatChatUpdatedAt(sameDay, now, 'zh-CN'),
    '11:00',
  )
  assert.match(
    formatChatUpdatedAt(older, now, 'zh-CN'),
    /7月20日/,
  )
})

test('uses the caller-provided yesterday label', () => {
  const now = new Date(2026, 6, 25, 12)
  const yesterday = new Date(2026, 6, 24, 11).toISOString()

  assert.equal(
    formatChatUpdatedAt(yesterday, now, 'en-US', 'Yesterday'),
    'Yesterday',
  )
})

test('marks and labels the active Chat', () => {
  assert.equal(isActiveChat('abc', 'abc'), true)
  assert.equal(isActiveChat('abc', undefined), false)
  assert.equal(
    getChatAccessibleName({ ...chats[0], title: 'Dashboard' }),
    '打开对话：Dashboard',
  )
})
