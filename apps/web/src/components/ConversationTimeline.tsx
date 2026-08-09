import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCode2,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import {
  canToggleTurn,
  canRetryValidation,
  formatCollapsedTurnLabel,
  formatPlanningDuration,
  getTimelineEventState,
  showsUserMessage,
  validationEventLabel,
  type ChatTimelineState,
} from '@/lib/chatTimeline'
import type {
  ChatTimelineEvent,
  ChatTimelineTurn,
} from '@/services/api'
import { formatAttachmentSize } from '@/lib/fileAttachments'
import { useI18n, type TranslationKey } from '@/lib/i18n'

interface ConversationTimelineProps {
  state: ChatTimelineState
  activeRunId?: string
  onToggleTurn: (runId: string) => void
  onLoadOlder: () => void
  onRetry: () => void
  onSelectSnapshot: (snapshotId: string) => void
  onCancelRun: (runId: string) => void
  retryingRunId?: string
  onRetryValidation: (runId: string) => void
}

const terminalStatuses = new Set([
  'completed',
  'completed_with_conflict',
  'failed',
  'cancelled',
])

const statusLabel = (
  status: ChatTimelineTurn['agent']['status'],
  t: (key: TranslationKey) => string,
): string => ({
  waiting_for_capacity: t('timeline.waitingCapacity'),
  queued: t('timeline.queued'),
  running: t('timeline.running'),
  planning: t('timeline.planning'),
  generating: t('timeline.generating'),
  validating: t('timeline.validating'),
  repairing: t('timeline.repairing'),
  persisting: t('timeline.persisting'),
  completed: t('timeline.completed'),
  completed_with_conflict: t('timeline.conflict'),
  failed: t('timeline.failed'),
  cancelled: t('timeline.cancelled'),
})[status]

const eventLabel = (
  event: ChatTimelineEvent,
  t: (key: TranslationKey) => string,
  language: 'zh-CN' | 'en-US',
): string => {
  if (
    event.type === 'validation.step'
    && typeof event.payload?.phase === 'string'
    && typeof event.payload?.status === 'string'
    && typeof event.payload?.attempt === 'number'
  ) {
    return validationEventLabel(event.payload as {
      phase: 'structure' | 'dependencies' | 'prisma' | 'migration' | 'type-check' | 'api-test' | 'build' | 'runtime-smoke' | string
      status: 'passed' | 'failed' | 'retrying' | 'skipped'
      category?: 'CODE_ERROR' | 'DEPENDENCY_ERROR' | 'INFRA_ERROR' | 'STYLING_CONFIGURATION_ERROR'
      attempt: number
      retryDelayMs?: number
      cache?: 'hit' | 'miss' | 'not-applicable'
      stylingIssues?: import('@/services/api').StylingIssue[]
    }, language)
  }
  const phase = typeof event.payload?.phase === 'string'
    ? event.payload.phase
    : undefined
  if (phase) {
    return ({
      planning: t('timeline.planning'),
      generating: t('timeline.generatingFiles'),
      validating: t('timeline.validating'),
      repairing: t('timeline.repairing'),
      persisting: t('timeline.persisting'),
    } as Record<string, string>)[phase] ?? event.message
  }

  return ({
    'run.created': t('timeline.runQueued'),
    'run.started': t('timeline.running'),
    'agent.plan': t('timeline.planReady'),
    'validation.started': t('timeline.validating'),
    'validation.failed': t('timeline.validationFailed'),
    'validation.passed': t('timeline.validationPassed'),
    'repair.started': t('timeline.repairing'),
    'run.completed': t('timeline.snapshotReady'),
    'run.failed': t('timeline.failed'),
    'run.cancelled': t('timeline.cancelled'),
  } as Record<string, string>)[event.type] ?? event.message
}

const formatTime = (value: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

function UserMessage({ turn }: { turn: ChatTimelineTurn }) {
  const { locale } = useI18n()

  return (
    <div className="flex justify-end">
      <div className="max-w-[88%]">
        <div className="rounded-2xl rounded-br-md bg-neutral-100 px-4 py-3 text-sm leading-6 text-neutral-800">
          <p className="whitespace-pre-wrap">{turn.userMessage.content}</p>
          {turn.userMessage.attachments?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {turn.userMessage.attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-neutral-200 bg-white/70 px-2 py-1 text-[11px] leading-4 text-neutral-600"
                >
                  <FileText className="h-3 w-3 shrink-0 text-neutral-400" />
                  <span className="max-w-40 truncate">{attachment.name}</span>
                  <span className="shrink-0 text-neutral-400">
                    {formatAttachmentSize(attachment.size)}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <p className="mt-1 text-right text-[11px] text-neutral-400">
          {formatTime(turn.userMessage.createdAt, locale)}
        </p>
      </div>
    </div>
  )
}

function ActivityRow({
  icon,
  children,
  tone = 'neutral',
}: {
  icon: ReactNode
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  return (
    <div
      className={`flex items-start gap-2 text-xs leading-5 ${
        tone === 'success'
          ? 'text-emerald-700'
          : tone === 'warning'
            ? 'text-amber-700'
          : tone === 'danger'
            ? 'text-red-700'
            : 'text-neutral-500'
      }`}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

function ImplementationPlan({ turn }: { turn: ChatTimelineTurn }) {
  const { t } = useI18n()
  const plan = turn.agent.plan
  if (!plan) return null

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-xs font-medium text-neutral-800">
        {t('timeline.planSteps', { count: plan.steps.length })}
      </p>
      <ol className="mt-2 space-y-2">
        {plan.steps.map((step, index) => (
          <li key={`${step.title}:${index}`} className="text-xs leading-5 text-neutral-600">
            <span className="font-medium text-neutral-800">
              {index + 1}. {step.title}
            </span>
            <span> — {step.intent}</span>
            {step.filesLikelyTouched.length > 0 ? (
              <p className="mt-0.5 text-[11px] text-neutral-400">
                {step.filesLikelyTouched.join(', ')}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {plan.assumptions.length > 0 ? (
        <div className="mt-2 border-t border-neutral-100 pt-2 text-[11px] leading-5 text-neutral-500">
          {t('timeline.assumptions', { value: plan.assumptions.join('；') })}
        </div>
      ) : null}
    </div>
  )
}

function AgentActivity({ turn }: { turn: ChatTimelineTurn }) {
  const { language, t } = useI18n()
  const planningDuration = formatPlanningDuration(turn.agent.planningDurationMs, language)
  const visibleEvents = turn.agent.events.filter(
    (event) => event.type !== 'agent.plan',
  )

  return (
    <div className="space-y-3">
      <ActivityRow icon={<Sparkles className="h-3.5 w-3.5" />}>
        {t('timeline.model', {
          value: `${turn.agent.modelProvider ? `${turn.agent.modelProvider} · ` : ''}${turn.agent.model}`,
        })}
      </ActivityRow>

      {planningDuration ? (
        <ActivityRow icon={<Sparkles className="h-3.5 w-3.5" />}>
          {planningDuration}
        </ActivityRow>
      ) : null}

      {turn.agent.plan?.summary ? (
        <p className="text-sm leading-6 text-neutral-700">
          {turn.agent.plan.summary}
        </p>
      ) : null}

      <ImplementationPlan turn={turn} />

      {visibleEvents.length > 0 ? (
        <div className="space-y-2">
          {visibleEvents.map((event, eventIndex) => {
            const eventState = getTimelineEventState(
              turn.agent.status,
              event,
              eventIndex,
              visibleEvents.length,
            )
            const isFailure = eventState === 'failed'
            const isDone = eventState === 'done'
            const isWarning = event.type === 'validation.step'
              && event.payload?.category === 'INFRA_ERROR'
            const path = typeof event.payload?.path === 'string'
              ? event.payload.path
              : undefined
            return (
              <ActivityRow
                key={`${turn.runId}:${event.sequence}`}
                icon={
                  isFailure
                    ? <AlertCircle className="h-3.5 w-3.5" />
                    : isWarning
                      ? <AlertTriangle className="h-3.5 w-3.5" />
                    : event.type === 'file.changed'
                        ? <FileCode2 className="h-3.5 w-3.5" />
                      : isDone
                        ? <CheckCircle2 className="h-3.5 w-3.5" />
                        : <Loader2 className="h-3.5 w-3.5 animate-spin" />
                }
                tone={
                  isFailure
                    ? 'danger'
                    : isWarning
                      ? 'warning'
                      : isDone
                        ? 'success'
                        : 'neutral'
                }
              >
                {eventLabel(event, t, language)}
                {path ? ` · ${path}` : ''}
              </ActivityRow>
            )
          })}
        </div>
      ) : null}

      {turn.agent.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
          <p className="font-medium">{turn.agent.error.message}</p>
          {turn.agent.error.code ? (
            <p className="mt-1 text-red-600">{turn.agent.error.code}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SnapshotResult({
  turn,
  onSelectSnapshot,
}: {
  turn: ChatTimelineTurn
  onSelectSnapshot: (snapshotId: string) => void
}) {
  const { t } = useI18n()
  if (!turn.snapshot) return null
  const shortId = turn.snapshot.id.slice(-6)

  return (
    <button
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left hover:bg-neutral-50"
      onClick={() => onSelectSnapshot(turn.snapshot!.id)}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-neutral-800">
          Snapshot {shortId}
        </span>
        <span className="block text-[11px] text-neutral-500">
          {t('timeline.changedFiles', { count: turn.snapshot.changedFiles.length })}
        </span>
      </span>
      <span className="text-xs text-neutral-400">{t('common.view')}</span>
    </button>
  )
}

function TurnSummary({
  turn,
  expanded,
  onToggle,
}: {
  turn: ChatTimelineTurn
  expanded: boolean
  onToggle: () => void
}) {
  const { language } = useI18n()
  return (
    <button
      className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-left hover:bg-neutral-50"
      aria-expanded={expanded}
      aria-controls={`agent-turn-detail-${turn.runId}`}
      data-testid={`agent-turn-summary-${turn.runId}`}
      onClick={onToggle}
    >
      {turn.agent.status === 'failed' ? (
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
      ) : turn.agent.status === 'cancelled' ? (
        <Square className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700">
        {formatCollapsedTurnLabel(turn, language)}
      </span>
      {expanded
        ? <ChevronUp className="h-4 w-4 shrink-0 text-neutral-400" />
        : <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />}
    </button>
  )
}

function AgentTurn({
  turn,
  expanded,
  activeRunId,
  onToggle,
  onSelectSnapshot,
  onCancelRun,
  retryingRunId,
  onRetryValidation,
}: {
  turn: ChatTimelineTurn
  expanded: boolean
  activeRunId?: string
  onToggle: () => void
  onSelectSnapshot: (snapshotId: string) => void
  onCancelRun: (runId: string) => void
  retryingRunId?: string
  onRetryValidation: (runId: string) => void
}) {
  const { t } = useI18n()
  const terminal = terminalStatuses.has(turn.agent.status)
  const isActive = activeRunId === turn.runId && !terminal
  const showDetails = !terminal || expanded

  return (
    <div className="mt-3">
      {canToggleTurn(turn) ? (
        <TurnSummary turn={turn} expanded={expanded} onToggle={onToggle} />
      ) : (
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>{statusLabel(turn.agent.status, t)}</span>
        </div>
      )}

      {showDetails ? (
        <div
          id={`agent-turn-detail-${turn.runId}`}
          data-testid={`agent-turn-detail-${turn.runId}`}
          className="ml-1 mt-3 border-l-2 border-neutral-200 pl-4"
        >
          <AgentActivity turn={turn} />

          {canRetryValidation(turn) ? (
            <button
              className="mt-3 inline-flex h-8 items-center rounded-md bg-neutral-950 px-3 text-xs font-medium text-white disabled:opacity-50"
              disabled={retryingRunId === turn.runId}
              onClick={() => onRetryValidation(turn.runId)}
            >
              {retryingRunId === turn.runId ? t('timeline.revalidating') : t('timeline.revalidate')}
            </button>
          ) : null}

          {turn.agent.summary && turn.agent.summary !== turn.agent.plan?.summary ? (
            <p className="mt-4 text-sm leading-6 text-neutral-700">
              {turn.agent.summary}
            </p>
          ) : null}

          {turn.snapshot ? (
            <div className="mt-3">
              <SnapshotResult turn={turn} onSelectSnapshot={onSelectSnapshot} />
            </div>
          ) : null}

          {isActive ? (
            <button
              className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50"
              onClick={() => onCancelRun(turn.runId)}
            >
              <Square className="h-3 w-3 fill-current" />
              {t('timeline.stop')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ConversationTimeline({
  state,
  activeRunId,
  onToggleTurn,
  onLoadOlder,
  onRetry,
  onSelectSnapshot,
  onCancelRun,
  retryingRunId,
  onRetryValidation,
}: ConversationTimelineProps) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const olderScrollHeightRef = useRef<number>()
  const newestTurn = state.turns[state.turns.length - 1]
  const newestEventCount = newestTurn?.agent.events.length ?? 0

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    if (olderScrollHeightRef.current !== undefined && !state.loadingOlder) {
      container.scrollTop += container.scrollHeight - olderScrollHeightRef.current
      olderScrollHeightRef.current = undefined
      return
    }

    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [state.turns.length, newestEventCount, newestTurn?.agent.status, state.loadingOlder])

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    pinnedRef.current = (
      container.scrollHeight - container.scrollTop - container.clientHeight
    ) <= 80
  }

  const handleLoadOlder = () => {
    const container = scrollRef.current
    if (container) olderScrollHeightRef.current = container.scrollHeight
    onLoadOlder()
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto"
      data-testid="conversation-timeline"
      onScroll={handleScroll}
    >
      <div className="space-y-6 p-4">
        {state.pageInfo.hasMore ? (
          <div className="text-center">
            <button
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              disabled={state.loadingOlder}
              onClick={handleLoadOlder}
            >
              {state.loadingOlder ? t('common.loading') : t('timeline.loadOlder')}
            </button>
          </div>
        ) : null}

        {state.loading && state.turns.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('timeline.loadingConversation')}
          </div>
        ) : state.error && state.turns.length === 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">
            <p>{state.error}</p>
            <button
              className="mt-3 rounded-md bg-neutral-950 px-3 py-1.5 text-xs text-white"
              onClick={onRetry}
            >
              {t('timeline.reloadConversation')}
            </button>
          </div>
        ) : state.turns.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-400">
            {t('timeline.startBuilding')}
          </p>
        ) : (
          <ol className="space-y-7">
            {state.turns.map((turn) => (
              <li
                key={turn.runId}
                data-testid={`conversation-turn-${turn.runId}`}
              >
                {showsUserMessage(turn) ? (
                  <UserMessage turn={turn} />
                ) : (
                  <div
                    className="flex items-center gap-2 text-xs font-medium text-neutral-500"
                    data-testid={`validation-retry-${turn.runId}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t('timeline.retryPrevious')}</span>
                  </div>
                )}
                <AgentTurn
                  turn={turn}
                  expanded={state.expandedRunIds.has(turn.runId)}
                  activeRunId={activeRunId}
                  onToggle={() => onToggleTurn(turn.runId)}
                  onSelectSnapshot={onSelectSnapshot}
                  onCancelRun={onCancelRun}
                  retryingRunId={retryingRunId}
                  onRetryValidation={onRetryValidation}
                />
              </li>
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
