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
