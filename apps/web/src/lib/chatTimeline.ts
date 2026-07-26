import type {
  AgentRun,
  ChatTimelineEvent,
  ChatTimelinePlan,
  ChatTimelineResponse,
  ChatTimelineTurn,
} from '@/services/api'

export interface ChatTimelineState {
  turns: ChatTimelineTurn[]
  expandedRunIds: Set<string>
  loading: boolean
  loadingOlder: boolean
  error?: string
  pageInfo: ChatTimelineResponse['pageInfo']
}

const activeStatuses = new Set<ChatTimelineTurn['agent']['status']>([
  'waiting_for_capacity',
  'queued',
  'running',
  'planning',
  'generating',
  'validating',
  'repairing',
  'persisting',
])

export const terminalStatuses = new Set<ChatTimelineTurn['agent']['status']>([
  'completed',
  'completed_with_conflict',
  'failed',
  'cancelled',
])

const isCompletedStatus = (
  status: ChatTimelineTurn['agent']['status'],
): boolean => status === 'completed' || status === 'completed_with_conflict'

export type TimelineEventState = 'active' | 'done' | 'failed'

export const getTimelineEventState = (
  turnStatus: ChatTimelineTurn['agent']['status'],
  event: ChatTimelineEvent,
  eventIndex: number,
  eventCount: number,
): TimelineEventState => {
  if (
    event.type === 'run.failed'
    || event.type === 'validation.failed'
    || event.type === 'run.cancelled'
  ) {
    return 'failed'
  }

  if (
    event.type === 'run.completed'
    || event.type === 'validation.passed'
    || terminalStatuses.has(turnStatus)
    || eventIndex < eventCount - 1
  ) {
    return 'done'
  }

  return 'active'
}

export const canToggleTurn = (turn: ChatTimelineTurn): boolean =>
  terminalStatuses.has(turn.agent.status)

export interface ValidationEventPayload {
  phase: 'structure' | 'dependencies' | 'type-check' | 'build'
  status: 'passed' | 'failed' | 'retrying' | 'skipped'
  category?: 'CODE_ERROR' | 'DEPENDENCY_ERROR' | 'INFRA_ERROR'
  attempt: number
  retryDelayMs?: number
  cache?: 'hit' | 'miss' | 'not-applicable'
}

export const validationEventLabel = (
  payload: ValidationEventPayload,
): string => {
  if (
    payload.phase === 'dependencies'
    && payload.status === 'retrying'
    && payload.category === 'INFRA_ERROR'
  ) {
    const seconds = Math.max(1, Math.round((payload.retryDelayMs ?? 0) / 1_000))
    return `依赖服务暂时不可用，${seconds} 秒后重试（${payload.attempt}/2）`
  }
  if (payload.phase === 'dependencies' && payload.status === 'passed') {
    return payload.cache === 'hit' ? '依赖缓存命中' : '依赖安装完成'
  }
  const phaseLabel = {
    structure: '项目结构检查',
    dependencies: '依赖准备',
    'type-check': 'TypeScript 检查',
    build: '生产构建',
  }[payload.phase]
  const statusLabel = {
    passed: '通过',
    failed: '失败',
    retrying: '重试中',
    skipped: '已跳过',
  }[payload.status]
  return `${phaseLabel}${statusLabel}`
}

export const canRetryValidation = (turn: ChatTimelineTurn): boolean =>
  turn.agent.status === 'failed'
  && turn.agent.retryable === true
  && turn.agent.error?.code === 'VALIDATION_INFRA_ERROR'

export const formatPlanningDuration = (
  durationMs?: number,
): string | undefined => durationMs === undefined
  ? undefined
  : `规划用时 ${Math.max(1, Math.round(durationMs / 1000))} 秒`

const formatDuration = (durationMs?: number): string | undefined =>
  durationMs === undefined
    ? undefined
    : `${Math.max(1, Math.round(durationMs / 1000))} 秒`

export const formatCollapsedTurnLabel = (
  turn: ChatTimelineTurn,
): string => {
  if (turn.agent.status === 'failed') {
    return `生成失败 · ${turn.agent.error?.message ?? '运行未完成'}`
  }
  if (turn.agent.status === 'cancelled') {
    return '已取消 · 保留已完成的工作步骤'
  }
  if (turn.agent.status === 'completed_with_conflict') {
    return `已保存 · 分支已变化 · ${
      turn.agent.summary ?? turn.snapshot?.summary ?? '替代版本'
    }`
  }

  const summary = turn.agent.summary ?? turn.agent.plan?.summary ?? '生成完成'
  const changedFiles = turn.snapshot?.changedFiles.length ?? 0
  const duration = formatDuration(turn.agent.durationMs)

  return [
    '已完成',
    summary,
    ...(changedFiles > 0 ? [`修改 ${changedFiles} 个文件`] : []),
    ...(duration ? [duration] : []),
  ].join(' · ')
}

export const createTimelineState = (): ChatTimelineState => ({
  turns: [],
  expandedRunIds: new Set(),
  loading: false,
  loadingOlder: false,
  pageInfo: { hasMore: false },
})

export const resetTimeline = (
  _state: ChatTimelineState,
): ChatTimelineState => createTimelineState()

export const resolveDefaultExpandedRunIds = (
  turns: ChatTimelineTurn[],
): Set<string> => {
  const expanded = new Set<string>()
  const latestCompleted = [...turns]
    .reverse()
    .find((turn) => isCompletedStatus(turn.agent.status))

  if (latestCompleted) expanded.add(latestCompleted.runId)

  for (const turn of turns) {
    if (
      turn.agent.status === 'failed'
      || activeStatuses.has(turn.agent.status)
    ) {
      expanded.add(turn.runId)
    }
  }

  return expanded
}

export const replaceTimelinePage = (
  state: ChatTimelineState,
  response: ChatTimelineResponse,
): ChatTimelineState => ({
  ...state,
  turns: response.turns,
  expandedRunIds: resolveDefaultExpandedRunIds(response.turns),
  loading: false,
  loadingOlder: false,
  error: undefined,
  pageInfo: response.pageInfo,
})

export const mergeOlderTimelinePage = (
  state: ChatTimelineState,
  response: ChatTimelineResponse,
): ChatTimelineState => {
  const turnsByRunId = new Map<string, ChatTimelineTurn>()
  for (const turn of [...response.turns, ...state.turns]) {
    turnsByRunId.set(turn.runId, turn)
  }
  const turns = [...turnsByRunId.values()].sort(
    (left, right) =>
      Date.parse(left.userMessage.createdAt)
      - Date.parse(right.userMessage.createdAt),
  )
  const expandedRunIds = new Set(state.expandedRunIds)
  for (const turn of response.turns) {
    if (
      turn.agent.status === 'failed'
      || activeStatuses.has(turn.agent.status)
    ) {
      expandedRunIds.add(turn.runId)
    }
  }

  return {
    ...state,
    turns,
    expandedRunIds,
    loadingOlder: false,
    error: undefined,
    pageInfo: response.pageInfo,
  }
}

export const appendTimelineEvent = (
  state: ChatTimelineState,
  runId: string,
  event: ChatTimelineEvent,
): ChatTimelineState => {
  const turnIndex = state.turns.findIndex((turn) => turn.runId === runId)
  if (turnIndex === -1) return state
  const turn = state.turns[turnIndex]
  if (turn.agent.events.some((candidate) => candidate.sequence === event.sequence)) {
    return state
  }

  const turns = [...state.turns]
  turns[turnIndex] = {
    ...turn,
    agent: {
      ...turn.agent,
      events: [...turn.agent.events, event].sort(
        (left, right) => left.sequence - right.sequence,
      ),
    },
  }

  return { ...state, turns }
}

export const insertTimelineRun = (
  state: ChatTimelineState,
  run: AgentRun,
): ChatTimelineState => {
  if (state.turns.some((turn) => turn.runId === run._id)) return state
  const createdAt = run.createdAt ?? new Date().toISOString()
  const turn: ChatTimelineTurn = {
    runId: run._id,
    userMessage: {
      content: run.prompt,
      createdAt,
    },
    agent: {
      status: run.status,
      model: run.model ?? 'configured model',
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      events: [],
      ...(run.error?.message ? {
        error: {
          code: run.error.code,
          message: run.error.message,
        },
      } : {}),
    },
  }

  return {
    ...state,
    turns: [...state.turns, turn].sort(
      (left, right) =>
        Date.parse(left.userMessage.createdAt)
        - Date.parse(right.userMessage.createdAt),
    ),
    expandedRunIds: new Set([...state.expandedRunIds, run._id]),
  }
}

const statusFromEvent = (
  event: ChatTimelineEvent,
  current: ChatTimelineTurn['agent']['status'],
): ChatTimelineTurn['agent']['status'] => {
  if (event.type === 'run.created') return 'queued'
  if (event.type === 'run.started') return 'running'
  if (event.type === 'validation.started') return 'validating'
  if (event.type === 'repair.started') return 'repairing'
  if (event.type === 'run.completed') {
    return event.payload?.conflict === true
      ? 'completed_with_conflict'
      : 'completed'
  }
  if (event.type === 'run.failed') return 'failed'
  if (event.type === 'run.cancelled') return 'cancelled'
  const phase = event.type === 'agent.step'
    && typeof event.payload?.phase === 'string'
    ? event.payload.phase
    : undefined
  return (
    phase === 'planning'
    || phase === 'generating'
    || phase === 'validating'
    || phase === 'repairing'
    || phase === 'persisting'
  ) ? phase : current
}

const planFromEvent = (
  event: ChatTimelineEvent,
): ChatTimelinePlan | undefined => {
  if (event.type !== 'agent.plan' || !event.payload) return undefined
  const { summary, steps, assumptions } = event.payload
  if (
    typeof summary !== 'string'
    || !Array.isArray(steps)
    || !Array.isArray(assumptions)
    || !assumptions.every((assumption) => typeof assumption === 'string')
  ) {
    return undefined
  }
  const parsedSteps = steps.flatMap((step) => {
    if (!step || typeof step !== 'object') return []
    const candidate = step as Record<string, unknown>
    if (
      typeof candidate.title !== 'string'
      || typeof candidate.intent !== 'string'
      || !Array.isArray(candidate.filesLikelyTouched)
      || !candidate.filesLikelyTouched.every((path) => typeof path === 'string')
    ) {
      return []
    }
    return [{
      title: candidate.title,
      intent: candidate.intent,
      filesLikelyTouched: candidate.filesLikelyTouched as string[],
    }]
  })
  if (parsedSteps.length !== steps.length || parsedSteps.length === 0) {
    return undefined
  }
  return {
    summary,
    steps: parsedSteps,
    assumptions: assumptions as string[],
  }
}

export const applyTimelineEvent = (
  state: ChatTimelineState,
  runId: string,
  event: ChatTimelineEvent,
): ChatTimelineState => {
  const appended = appendTimelineEvent(state, runId, event)
  if (appended === state) return state
  const turnIndex = appended.turns.findIndex((turn) => turn.runId === runId)
  if (turnIndex === -1) return state
  const turn = appended.turns[turnIndex]
  const status = statusFromEvent(event, turn.agent.status)
  const plan = planFromEvent(event)
  const startedAt = event.type === 'run.started'
    ? event.createdAt
    : turn.agent.startedAt
  const completedAt = (
    isCompletedStatus(status)
    || status === 'failed'
    || status === 'cancelled'
  ) ? event.createdAt : turn.agent.completedAt
  const planningDurationMs = plan && turn.agent.startedAt
    ? Math.max(
        0,
        Date.parse(event.createdAt) - Date.parse(turn.agent.startedAt),
      )
    : turn.agent.planningDurationMs
  const turns = [...appended.turns]
  turns[turnIndex] = {
    ...turn,
    agent: {
      ...turn.agent,
      status,
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(startedAt && completedAt ? {
        durationMs: Math.max(
          0,
          Date.parse(completedAt) - Date.parse(startedAt),
        ),
      } : {}),
      ...(plan ? {
        plan,
        summary: plan.summary,
      } : {}),
      ...(planningDurationMs === undefined ? {} : { planningDurationMs }),
      ...(status === 'failed' ? {
        error: {
          message: event.message,
        },
      } : {}),
    },
  }
  const expandedRunIds = new Set(appended.expandedRunIds)
  if (isCompletedStatus(status)) {
    for (const candidate of turns) {
      if (
        candidate.runId !== runId
        && isCompletedStatus(candidate.agent.status)
      ) {
        expandedRunIds.delete(candidate.runId)
      }
    }
    expandedRunIds.add(runId)
  } else if (status === 'failed' || activeStatuses.has(status)) {
    expandedRunIds.add(runId)
  }

  return { ...appended, turns, expandedRunIds }
}

export const toggleTimelineTurn = (
  state: ChatTimelineState,
  runId: string,
): ChatTimelineState => {
  const turn = state.turns.find((candidate) => candidate.runId === runId)
  if (!turn || !canToggleTurn(turn)) return state
  const expandedRunIds = new Set(state.expandedRunIds)
  if (expandedRunIds.has(runId)) expandedRunIds.delete(runId)
  else expandedRunIds.add(runId)
  return { ...state, expandedRunIds }
}

export const startTimelineLoading = (
  state: ChatTimelineState,
  older = false,
): ChatTimelineState => ({
  ...state,
  ...(older ? { loadingOlder: true } : { loading: true }),
  error: undefined,
})

export const failTimelineLoading = (
  state: ChatTimelineState,
  error: string,
): ChatTimelineState => ({
  ...state,
  loading: false,
  loadingOlder: false,
  error,
})
