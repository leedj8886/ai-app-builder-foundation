import type {
  ChatTimelineEvent,
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
  'failed',
  'cancelled',
])

export const canToggleTurn = (turn: ChatTimelineTurn): boolean =>
  terminalStatuses.has(turn.agent.status)

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

export const resolveDefaultExpandedRunIds = (
  turns: ChatTimelineTurn[],
): Set<string> => {
  const expanded = new Set<string>()
  const latestCompleted = [...turns]
    .reverse()
    .find((turn) => turn.agent.status === 'completed')

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
