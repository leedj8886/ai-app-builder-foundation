import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ChatTimelineEvent,
  ChatTimelineResponse,
  ChatTimelineTurn,
} from '@/services/api'
import {
  appendTimelineEvent,
  createTimelineState,
  mergeOlderTimelinePage,
  replaceTimelinePage,
  resolveDefaultExpandedRunIds,
} from './chatTimeline'

const turn = (
  runId: string,
  status: ChatTimelineTurn['agent']['status'],
): ChatTimelineTurn => ({
  runId,
  userMessage: {
    content: `Prompt ${runId}`,
    createdAt: '2026-07-25T10:00:00.000Z',
  },
  agent: {
    status,
    model: 'test-model',
    events: [],
  },
})

const event = (sequence: number): ChatTimelineEvent => ({
  type: 'agent.step',
  sequence,
  message: `Step ${sequence}`,
  payload: { phase: 'generating' },
  createdAt: '2026-07-25T10:00:01.000Z',
})

const page = (
  turns: ChatTimelineTurn[],
  hasMore = false,
): ChatTimelineResponse => ({
  chat: {
    id: 'chat-1',
    title: 'Timeline',
    projectId: 'project-1',
  },
  turns,
  pageInfo: {
    hasMore,
    ...(hasMore ? { nextBefore: 'older-page' } : {}),
  },
})

test('expands active failed and latest completed turns by default', () => {
  const expanded = resolveDefaultExpandedRunIds([
    turn('old', 'completed'),
    turn('latest', 'completed'),
    turn('failed', 'failed'),
    turn('active', 'generating'),
  ])

  assert.deepEqual([...expanded], ['latest', 'failed', 'active'])
})

test('deduplicates streamed events by run id and sequence', () => {
  const initial = replaceTimelinePage(
    createTimelineState(),
    page([turn('active', 'generating')]),
  )
  const once = appendTimelineEvent(initial, 'active', event(3))
  const twice = appendTimelineEvent(once, 'active', event(3))

  assert.equal(twice.turns[0]?.agent.events.length, 1)
})

test('prepends older pages without duplicating turns', () => {
  const initial = replaceTimelinePage(
    createTimelineState(),
    page([turn('b', 'completed'), turn('c', 'completed')], true),
  )
  const merged = mergeOlderTimelinePage(
    initial,
    page([turn('a', 'completed'), turn('b', 'completed')]),
  )

  assert.deepEqual(merged.turns.map((item) => item.runId), ['a', 'b', 'c'])
  assert.equal(merged.pageInfo.hasMore, false)
})
