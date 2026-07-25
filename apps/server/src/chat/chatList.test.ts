import assert from 'node:assert/strict';
import test from 'node:test';
import { projectChatListItem } from './chatList';

test('uses and bounds the first user message as preview', () => {
  const item = projectChatListItem({
    _id: '66a3f4402f24b17418d55abc',
    title: 'Dashboard',
    messages: [
      { role: 'system', content: 'ignored' },
      { role: 'user', content: `  ${'x'.repeat(220)}  ` },
      { role: 'user', content: 'ignored second prompt' }
    ],
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    updatedAt: new Date('2026-07-25T11:00:00.000Z')
  });

  assert.equal(item.preview, `${'x'.repeat(157)}...`);
  assert.equal(item.updatedAt, '2026-07-25T11:00:00.000Z');
  assert.equal('messages' in item, false);
});

test('omits preview when a Chat has no user message', () => {
  const item = projectChatListItem({
    _id: '66a3f4402f24b17418d55abd',
    title: 'Empty',
    messages: [],
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    updatedAt: new Date('2026-07-25T10:00:00.000Z')
  });

  assert.equal(item.preview, undefined);
});
