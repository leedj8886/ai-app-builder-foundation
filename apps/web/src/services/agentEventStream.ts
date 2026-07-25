import { agentEventStreamUrl, type AgentEvent } from './api'

const RETRY_DELAYS_MS = [250, 500, 1000] as const
const TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled'])
const PUBLIC_AGENT_EVENT_TYPES = new Set([
  'run.created',
  'run.started',
  'agent.step',
  'agent.plan',
  'file.changed',
  'validation.started',
  'validation.failed',
  'validation.passed',
  'repair.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
])

export type AgentStreamState = 'connected' | 'retrying'

type FetchImplementation = typeof fetch
type Sleep = (durationMs: number, signal: AbortSignal) => Promise<void>

export interface StreamAgentEventsOptions {
  runId: string
  token: string
  signal: AbortSignal
  lastEventId?: number
  maxReconnectAttempts?: number
  fetchImpl?: FetchImplementation
  sleep?: Sleep
  onEvent: (event: AgentEvent) => void | Promise<void>
  onState?: (state: AgentStreamState) => void
}

export type StreamAgentEventsResult =
  | { outcome: 'terminal'; lastEventId: number }
  | { outcome: 'exhausted'; lastEventId?: number }

export class AgentStreamHttpError extends Error {
  readonly status: number

  constructor(status: number, statusText: string) {
    super(`Agent event stream request failed (${status}${statusText ? ` ${statusText}` : ''})`)
    this.name = 'AgentStreamHttpError'
    this.status = status
  }
}

class AgentStreamProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentStreamProtocolError'
  }
}

class AgentStreamRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentStreamRetryableError'
  }
}

class AgentStreamApplicationError extends Error {
  readonly original: unknown

  constructor(original: unknown) {
    super('Agent event stream callback failed')
    this.name = 'AgentStreamApplicationError'
    this.original = original
  }
}

interface SseFrame {
  id?: string
  event?: string
  data: string[]
}

const abortError = (): Error => {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError()
}

const waitForAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise
  if (signal.aborted) {
    void promise.catch(() => undefined)
    throw abortError()
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

const defaultAbortableSleep: Sleep = (durationMs, signal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) {
    reject(abortError())
    return
  }

  let settled = false
  const finish = (callback: () => void): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    callback()
  }
  const onAbort = (): void => finish(() => reject(abortError()))
  const timer = setTimeout(() => finish(resolve), durationMs)
  signal.addEventListener('abort', onAbort, { once: true })
})

const normalizeReconnectAttempts = (value: number | undefined): number => {
  if (value === undefined) return 3
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

const retryDelay = (retryNumber: number): number =>
  RETRY_DELAYS_MS[Math.min(retryNumber - 1, RETRY_DELAYS_MS.length - 1)] ?? 1000

const isNonNegativeInteger = (value: string): boolean => /^\d+$/.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseAgentEvent = (frame: SseFrame): { event: AgentEvent; id: number } | undefined => {
  if (frame.data.length === 0) return undefined

  let value: unknown
  try {
    value = JSON.parse(frame.data.join('\n'))
  } catch {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: data is not valid JSON')
  }

  if (!isRecord(value)) {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: data must be an object')
  }

  const { sequence, type, message, payload } = value
  if (
    typeof sequence !== 'number' ||
    !Number.isFinite(sequence) ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    typeof type !== 'string' ||
    !PUBLIC_AGENT_EVENT_TYPES.has(type) ||
    typeof message !== 'string' ||
    (payload !== undefined && !isRecord(payload))
  ) {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: invalid event fields')
  }

  if (frame.event !== undefined && frame.event !== type) {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: event type does not match data')
  }

  if (frame.id === undefined || !isNonNegativeInteger(frame.id) || Number(frame.id) !== sequence) {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: id does not match sequence')
  }

  return {
    event: {
      sequence,
      type,
      message,
      ...(payload !== undefined ? { payload } : {}),
    },
    id: Number(frame.id),
  }
}

const processLine = (frame: SseFrame, line: string): void => {
  if (line.startsWith(':')) return
  const separator = line.indexOf(':')
  const field = separator === -1 ? line : line.slice(0, separator)
  const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')

  if (field === 'id') frame.id = value
  if (field === 'event') frame.event = value
  if (field === 'data') frame.data.push(value)
}

interface ConsumeResult {
  terminal: boolean
  lastEventId?: number
  lastSequence?: number
}

const consumeResponse = async ({
  response,
  signal,
  lastSequence,
  onEvent,
  onProgress,
}: {
  response: Response
  signal: AbortSignal
  lastSequence?: number
  onEvent: (event: AgentEvent) => void | Promise<void>
  onProgress: (id: number, sequence: number) => void
}): Promise<ConsumeResult> => {
  if (!response.body) {
    throw new AgentStreamProtocolError('Agent event stream response has no body')
  }
  const contentType = response.headers.get('Content-Type')
  if (!contentType?.toLowerCase().includes('text/event-stream')) {
    throw new AgentStreamProtocolError('Agent event stream response is not text/event-stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let frame: SseFrame = { data: [] }
  let acceptedSequence = lastSequence
  let acceptedId: number | undefined
  let terminal = false
  let reachedEof = false

  const dispatchFrame = async (): Promise<void> => {
    const parsed = parseAgentEvent(frame)
    frame = { data: [] }
    if (!parsed || (acceptedSequence !== undefined && parsed.event.sequence <= acceptedSequence)) return

    try {
      await waitForAbort(Promise.resolve().then(() => onEvent(parsed.event)), signal)
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw abortError()
      throw new AgentStreamApplicationError(error)
    }
    acceptedSequence = parsed.event.sequence
    acceptedId = parsed.id
    onProgress(acceptedId, acceptedSequence)
    throwIfAborted(signal)
    if (TERMINAL_EVENT_TYPES.has(parsed.event.type)) terminal = true
  }

  const processBufferedLines = async (endOfStream = false): Promise<void> => {
    let newlineIndex = buffer.search(/[\r\n]/)
    while (newlineIndex !== -1) {
      const delimiter = buffer[newlineIndex]
      if (delimiter === '\r' && newlineIndex === buffer.length - 1 && !endOfStream) return
      const line = buffer.slice(0, newlineIndex)
      const delimiterLength = delimiter === '\r' && buffer[newlineIndex + 1] === '\n' ? 2 : 1
      buffer = buffer.slice(newlineIndex + delimiterLength)
      if (line === '') await dispatchFrame()
      else processLine(frame, line)
      if (terminal) return
      newlineIndex = buffer.search(/[\r\n]/)
    }
  }

  try {
    while (!terminal) {
      throwIfAborted(signal)
      const { done, value } = await waitForAbort(reader.read(), signal)
      if (done) {
        buffer += decoder.decode()
        await processBufferedLines(true)
        reachedEof = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      await processBufferedLines()
    }
  } finally {
    if (!reachedEof) void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  return { terminal, lastEventId: acceptedId, lastSequence: acceptedSequence }
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError'

const isControlledFailure = (error: unknown): boolean =>
  error instanceof AgentStreamHttpError || error instanceof AgentStreamProtocolError

export const streamAgentEvents = async ({
  runId,
  token,
  signal,
  lastEventId: initialLastEventId,
  maxReconnectAttempts,
  fetchImpl = fetch,
  sleep,
  onEvent,
  onState,
}: StreamAgentEventsOptions): Promise<StreamAgentEventsResult> => {
  let lastEventId = initialLastEventId
  let lastSequence = initialLastEventId
  let reconnects = 0
  const maximumReconnects = normalizeReconnectAttempts(maxReconnectAttempts)

  while (true) {
    throwIfAborted(signal)
    try {
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      }
      if (lastEventId !== undefined) headers['Last-Event-ID'] = String(lastEventId)

      const response = await waitForAbort(fetchImpl(agentEventStreamUrl(runId), {
        headers,
        signal,
      }), signal)

      if (!response.ok) {
        if (response.status >= 500) {
          throw new AgentStreamRetryableError(`Agent event stream request failed (${response.status})`)
        }
        throw new AgentStreamHttpError(response.status, response.statusText)
      }

      try {
        onState?.('connected')
      } catch (error) {
        throw new AgentStreamApplicationError(error)
      }
      const result = await consumeResponse({
        response,
        signal,
        lastSequence,
        onEvent,
        onProgress: (id, sequence) => {
          lastEventId = id
          lastSequence = sequence
        },
      })
      lastSequence = result.lastSequence
      if (result.lastEventId !== undefined) lastEventId = result.lastEventId
      throwIfAborted(signal)
      if (result.terminal) return { outcome: 'terminal', lastEventId: lastEventId as number }
      throw new AgentStreamRetryableError('Agent event stream ended before a terminal event')
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw abortError()
      if (error instanceof AgentStreamApplicationError) throw error.original
      if (isControlledFailure(error)) throw error
      if (reconnects >= maximumReconnects) {
        return { outcome: 'exhausted', ...(lastEventId !== undefined ? { lastEventId } : {}) }
      }

      reconnects += 1
      onState?.('retrying')
      await waitForAbort((sleep ?? defaultAbortableSleep)(retryDelay(reconnects), signal), signal)
    }
  }
}
