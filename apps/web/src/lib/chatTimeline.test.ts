import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ChatTimelineEvent,
  ChatTimelineResponse,
  ChatTimelineTurn,
} from '@/services/api'
import {
  appendTimelineEvent,
  applyTimelineEvent,
  canToggleTurn,
  canRetryValidation,
  createTimelineState,
  formatCollapsedTurnLabel,
  formatPlanningDuration,
  getTimelineEventState,
  validationEventLabel,
  mergeOlderTimelinePage,
  insertTimelineRun,
  replaceTimelinePage,
  resetTimeline,
  resolveDefaultExpandedRunIds,
  showsUserMessage,
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

test('Branch conflict completion is terminal and keeps its Snapshot summary', () => {
  const conflict = turn('conflict', 'completed_with_conflict')
  conflict.snapshot = {
    id: 'snapshot-conflict',
    summary: 'Alternative result',
    changedFiles: ['src/App.tsx'],
  }

  assert.equal(canToggleTurn(conflict), true)
  assert.match(formatCollapsedTurnLabel(conflict), /分支已变化/)
});

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

test('formats completed and failed collapsed labels', () => {
  const completed = {
    ...turn('completed', 'completed'),
    agent: {
      ...turn('completed', 'completed').agent,
      durationMs: 29_000,
      summary: 'Added activity UI',
    },
    snapshot: {
      id: 'snapshot-1',
      summary: 'Added activity UI',
      changedFiles: ['src/App.tsx'],
    },
  }
  const failed = {
    ...turn('failed', 'failed'),
    agent: {
      ...turn('failed', 'failed').agent,
      error: { message: 'Type-check failed' },
    },
  }

  assert.equal(
    formatCollapsedTurnLabel(completed),
    '已完成 · Added activity UI · 修改 1 个文件 · 29 秒',
  )
  assert.equal(
    formatCollapsedTurnLabel(failed),
    '生成失败 · Type-check failed',
  )
})

test('labels planning duration without implying hidden reasoning', () => {
  assert.equal(formatPlanningDuration(2_100), '规划用时 2 秒')
  assert.equal(formatPlanningDuration(undefined), undefined)
  assert.equal(formatPlanningDuration(2_100)?.includes('思考'), false)
})

test('formats timeline summaries in English when requested', () => {
  const completed = turn('completed-en', 'completed')
  completed.agent.durationMs = 2_100
  completed.agent.summary = 'Updated dashboard'
  completed.snapshot = {
    id: 'snapshot-en',
    summary: 'Updated dashboard',
    changedFiles: ['src/App.tsx'],
  }

  assert.equal(formatPlanningDuration(2_100, 'en-US'), 'Planned in 2s')
  assert.equal(
    formatCollapsedTurnLabel(completed, 'en-US'),
    'Completed · Updated dashboard · 1 files changed · 2s',
  )
  assert.equal(validationEventLabel({
    phase: 'dependencies',
    status: 'passed',
    attempt: 1,
    cache: 'hit',
  }, 'en-US'), 'Dependency cache hit')
})

test('only terminal turns can be manually toggled', () => {
  assert.equal(canToggleTurn(turn('active', 'generating')), false)
  assert.equal(canToggleTurn(turn('completed', 'completed')), true)
  assert.equal(canToggleTurn(turn('failed', 'failed')), true)
  assert.equal(canToggleTurn(turn('cancelled', 'cancelled')), true)
})

test('labels infrastructure retries and only exposes retry for retryable failures', () => {
  assert.equal(validationEventLabel({
    phase: 'dependencies',
    status: 'retrying',
    category: 'INFRA_ERROR',
    attempt: 1,
    retryDelayMs: 5_000,
    cache: 'miss',
  }), '依赖服务暂时不可用，5 秒后重试（1/2）')

  const retryable = turn('infra', 'failed')
  retryable.agent.retryable = true
  retryable.agent.error = {
    code: 'VALIDATION_INFRA_ERROR',
    message: 'temporary',
  }
  const codeFailure = turn('code', 'failed')
  codeFailure.agent.error = {
    code: 'VALIDATION_FAILED',
    message: 'type error',
  }

  assert.equal(canRetryValidation(retryable), true)
  assert.equal(canRetryValidation(codeFailure), false)
})

test('labels structured styling build failures', () => {
  assert.equal(validationEventLabel({
    phase: 'build',
    status: 'failed',
    category: 'STYLING_CONFIGURATION_ERROR',
    attempt: 0,
    stylingIssues: [{
      capability: 'tailwind',
      code: 'UNEXPANDED_DIRECTIVE',
      phase: 'build-evidence',
      message: 'The emitted CSS still contains unexpanded Tailwind directives',
      previewRecoverable: false,
    }],
  }), '样式构建未生效 · Tailwind 指令未展开')
})

test('marks completed lifecycle events as done instead of leaving empty circles', () => {
  const queuedEvent: ChatTimelineEvent = {
    type: 'run.created',
    sequence: 1,
    message: 'Run queued',
    createdAt: '2026-07-25T10:00:00.000Z',
  }
  const generatingEvent: ChatTimelineEvent = {
    type: 'agent.step',
    sequence: 2,
    message: 'Generating files',
    payload: { phase: 'generating' },
    createdAt: '2026-07-25T10:00:01.000Z',
  }

  assert.equal(
    getTimelineEventState('completed', queuedEvent, 0, 2),
    'done',
  )
  assert.equal(
    getTimelineEventState('generating', queuedEvent, 0, 2),
    'done',
  )
  assert.equal(
    getTimelineEventState('generating', generatingEvent, 1, 2),
    'active',
  )
})

test('inserts the returned Run as the expanded active turn', () => {
  const state = replaceTimelinePage(
    createTimelineState(),
    page([turn('previous', 'completed')]),
  )
  const inserted = insertTimelineRun(state, {
    _id: 'active',
    projectId: 'project-1',
    prompt: 'Add filters',
    status: 'queued',
    mode: 'edit',
    model: 'deepseek-chat',
    createdAt: '2026-07-25T10:02:00.000Z',
  })

  assert.deepEqual(inserted.turns.map((item) => item.runId), ['previous', 'active'])
  assert.equal(inserted.expandedRunIds.has('active'), true)
})

test('inserts validation retries without presenting the prompt as a new message', () => {
  const state = replaceTimelinePage(
    createTimelineState(),
    page([turn('source', 'failed')]),
  )
  const inserted = insertTimelineRun(state, {
    _id: 'retry',
    projectId: 'project-1',
    prompt: 'Build a dashboard',
    status: 'queued',
    mode: 'create',
    model: 'deepseek-chat',
    retryOfRunId: 'source',
    createdAt: '2026-07-25T10:02:00.000Z',
  })
  const retry = inserted.turns[1]!

  assert.equal(retry.retryOfRunId, 'source')
  assert.equal(showsUserMessage(retry), false)
  assert.equal(showsUserMessage(inserted.turns[0]!), true)
})

test('terminal event completes the active turn and collapses the previous turn', () => {
  const state = replaceTimelinePage(
    createTimelineState(),
    page([turn('previous', 'completed'), turn('active', 'generating')]),
  )
  const completed = applyTimelineEvent(state, 'active', {
    type: 'run.completed',
    sequence: 8,
    message: 'Snapshot ready',
    createdAt: '2026-07-25T10:03:00.000Z',
  })

  assert.equal(completed.turns[1]?.agent.status, 'completed')
  assert.deepEqual([...completed.expandedRunIds], ['active'])
})

test('agent plan event populates the active turn immediately', () => {
  const state = replaceTimelinePage(
    createTimelineState(),
    page([turn('active', 'queued')]),
  )
  const started = applyTimelineEvent(state, 'active', {
    type: 'run.started',
    sequence: 2,
    message: 'Worker started',
    createdAt: '2026-07-25T10:00:01.000Z',
  })
  const planned = applyTimelineEvent(started, 'active', {
    type: 'agent.plan',
    sequence: 3,
    message: 'Add activity UI',
    payload: {
      summary: 'Add activity UI',
      steps: [{
        title: 'Update App',
        intent: 'Render recent activity',
        filesLikelyTouched: ['src/App.tsx'],
      }],
      assumptions: [],
    },
    createdAt: '2026-07-25T10:00:03.000Z',
  })

  assert.equal(planned.turns[0]?.agent.plan?.steps[0]?.title, 'Update App')
  assert.equal(planned.turns[0]?.agent.planningDurationMs, 2_000)
})

test('ignores events for a stale Run', () => {
  const state = replaceTimelinePage(
    createTimelineState(),
    page([turn('active', 'generating')]),
  )

  assert.equal(
    applyTimelineEvent(state, 'stale', event(2)),
    state,
  )
})

test('resetTimeline removes turns when chatId changes', () => {
  const state = replaceTimelinePage(
    createTimelineState(),
    page([turn('old-chat-run', 'completed')]),
  )

  assert.deepEqual(resetTimeline(state), createTimelineState())
})
