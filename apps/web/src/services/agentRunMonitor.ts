import { agentApi, type AgentRunDetailResponse } from './api'
import {
  streamAgentEvents,
  type StreamAgentEventsOptions,
  type StreamAgentEventsResult,
} from './agentEventStream'

const MAX_FALLBACK_ATTEMPTS = 60
const FALLBACK_DELAY_MS = 500
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled'])

type Stream = (options: StreamAgentEventsOptions) => Promise<StreamAgentEventsResult>
type GetRun = (runId: string) => Promise<{ data: AgentRunDetailResponse }>
type Delay = (durationMs: number, signal: AbortSignal) => Promise<void>

export interface MonitorAgentRunOptions {
  runId: string
  token: string
  signal: AbortSignal
  onEvent: StreamAgentEventsOptions['onEvent']
  stream?: Stream
  getRun?: GetRun
  delay?: Delay
}

const abortError = (): Error => {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw abortError()
}

const waitForAbort = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(abortError())
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

const abortableDelay: Delay = (durationMs, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(abortError())
    return
  }

  const timer = window.setTimeout(() => {
    signal.removeEventListener('abort', onAbort)
    resolve()
  }, durationMs)
  const onAbort = (): void => {
    window.clearTimeout(timer)
    reject(abortError())
  }
  signal.addEventListener('abort', onAbort, { once: true })
})

export const monitorAgentRun = async ({
  runId,
  token,
  signal,
  onEvent,
  stream = streamAgentEvents,
  getRun = agentApi.getRun,
  delay = abortableDelay,
}: MonitorAgentRunOptions): Promise<AgentRunDetailResponse> => {
  throwIfAborted(signal)
  const streamResult = await waitForAbort(stream({ runId, token, signal, onEvent }), signal)
  throwIfAborted(signal)

  if (streamResult.outcome === 'terminal') {
    const response = await waitForAbort(getRun(runId), signal)
    throwIfAborted(signal)
    return response.data
  }

  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal)
    const response = await waitForAbort(getRun(runId), signal)
    throwIfAborted(signal)
    if (TERMINAL_RUN_STATUSES.has(response.data.run.status)) return response.data

    if (attempt < MAX_FALLBACK_ATTEMPTS - 1) {
      await waitForAbort(delay(FALLBACK_DELAY_MS, signal), signal)
      throwIfAborted(signal)
    }
  }

  throw new Error('Timed out waiting for agent run')
}
