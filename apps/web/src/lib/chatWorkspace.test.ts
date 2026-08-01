import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildChatPath,
  buildEditRunRequest,
  buildWorkspaceRunRequest,
  resolveRoutedProjectId,
} from './chatWorkspace'

test('buildChatPath encodes a Chat id', () => {
  assert.equal(buildChatPath('chat / 1'), '/chats/chat%20%2F%201')
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
    modelId: 'quality-model',
  }), {
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: 'Add filters',
    mode: 'edit',
    modelId: 'quality-model',
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

test('buildWorkspaceRunRequest recreates a failed first generation without a Snapshot', () => {
  assert.deepEqual(buildWorkspaceRunRequest({
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: '  Try a simpler layout  ',
    activeSnapshotId: undefined,
    modelId: 'quality-model',
  }), {
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: 'Try a simpler layout',
    mode: 'create',
    modelId: 'quality-model',
  })

  assert.equal(buildWorkspaceRunRequest({
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: 'Add filters',
    activeSnapshotId: 'snapshot_123',
  }).mode, 'edit')
})

test('buildWorkspaceRunRequest forwards selected attachments', () => {
  const attachments = [{
    id: 'b4c62ae1-ea47-4cba-a8d2-53ef778d18f1',
    name: 'requirements.md',
    mediaType: 'text/markdown',
    size: 18,
    content: '# Product context',
  }]

  assert.deepEqual(buildWorkspaceRunRequest({
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: 'Use this specification',
    activeSnapshotId: 'snapshot_123',
    attachments,
  }).attachments, attachments)
})
