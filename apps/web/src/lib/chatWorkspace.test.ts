import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildChatPath,
  buildEditRunRequest,
  resolveRoutedProjectId,
} from './chatWorkspace'

test('buildChatPath encodes a Chat id', () => {
  assert.equal(buildChatPath('chat / 1'), '/v0/chats/chat%20%2F%201')
})

test('resolveRoutedProjectId requires a Chat-associated Project', () => {
  assert.equal(resolveRoutedProjectId({ projectId: 'project_123' }), 'project_123')
  assert.throws(
    () => resolveRoutedProjectId({ projectId: undefined }),
    /not associated with a project/,
  )
})

test('buildEditRunRequest requires an active Snapshot and preserves ids', () => {
  assert.deepEqual(buildEditRunRequest({
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: '  Add filters  ',
    activeSnapshotId: 'snapshot_123',
  }), {
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: 'Add filters',
    mode: 'edit',
  })
  assert.throws(
    () => buildEditRunRequest({
      chatId: 'chat_123',
      projectId: 'project_123',
      prompt: 'Add filters',
      activeSnapshotId: undefined,
    }),
    /active snapshot/,
  )
})
