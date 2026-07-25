import { agentEventStreamUrl, type AgentEvent } from './api'

const RETRY_DELAYS_MS = [250, 500, 1000] as const
const TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled'])

export type AgentStreamState = 'connected' | 'retrying'

type FetchImplementation = typeof fetch
type Sleep = (delayMs: number, signal?: AbortSignal) => Promise<void>

export interface StreamAgentEventsOptions {
  runId: string
  token: string
  signal?: AbortSignal
  lastEventId?: string
  maxReconnectAttempts?: number
  fetchImpl?: FetchImplementation
  sleep?: Sleep
  onEvent: (event: AgentEvent) => void
  onState?: (state: AgentStreamState) => void
}

export type StreamAgentEventsResult =
  | { status: 'terminal'; lastEventId: string }
  | { status: 'exhausted'; attempts: number; lastEventId?: string }

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

const defaultSleep: Sleep = (delayMs, signal) => waitForAbort(new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs)
}), signal)

const normalizeReconnectAttempts = (value: number | undefined): number => {
  if (value === undefined) return 3
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

const retryDelay = (retryNumber: number): number =>
  RETRY_DELAYS_MS[Math.min(retryNumber - 1, RETRY_DELAYS_MS.length - 1)] ?? 1000

const isNumericId = (id: string): boolean => id.trim() !== '' && Number.isFinite(Number(id))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseAgentEvent = (frame: SseFrame): { event: AgentEvent; id: string } | undefined => {
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
    sequence < 0 ||
    typeof type !== 'string' ||
    typeof message !== 'string'
  ) {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: invalid event fields')
  }

  if (frame.event !== undefined && frame.event !== type) {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: event type does not match data')
  }

  const id = frame.id ?? String(sequence)
  if (isNumericId(id) && Number(id) !== sequence) {
    throw new AgentStreamProtocolError('Invalid agent event stream frame: id does not match sequence')
  }

  return {
    event: {
      sequence,
      type,
      message,
      ...(isRecord(payload) ? { payload } : {}),
    },
    id,
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
  lastEventId?: string
  lastSequence?: number
}

const consumeResponse = async ({
  response,
  signal,
  lastSequence,
  onEvent,
}: {
  response: Response
  signal?: AbortSignal
  lastSequence?: number
  onEvent: (event: AgentEvent) => void
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
  let acceptedId: string | undefined
  let terminal = false
  let reachedEof = false

  const dispatchFrame = (): void => {
    const parsed = parseAgentEvent(frame)
    frame = { data: [] }
    if (!parsed || (acceptedSequence !== undefined && parsed.event.sequence <= acceptedSequence)) return

    acceptedSequence = parsed.event.sequence
    acceptedId = parsed.id
    onEvent(parsed.event)
    if (TERMINAL_EVENT_TYPES.has(parsed.event.type)) terminal = true
  }

  const processBufferedLines = (): void => {
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (line === '') dispatchFrame()
      else processLine(frame, line)
      if (terminal) return
      newlineIndex = buffer.indexOf('\n')
    }
  }

  try {
    while (!terminal) {
      throwIfAborted(signal)
      const { done, value } = await waitForAbort(reader.read(), signal)
      if (done) {
        buffer += decoder.decode()
        processBufferedLines()
        reachedEof = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      processBufferedLines()
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
  sleep = defaultSleep,
  onEvent,
  onState,
}: StreamAgentEventsOptions): Promise<StreamAgentEventsResult> => {
  let lastEventId = initialLastEventId
  let lastSequence = initialLastEventId !== undefined && isNumericId(initialLastEventId)
    ? Number(initialLastEventId)
    : undefined
  let attempts = 0
  let reconnects = 0
  const maximumReconnects = normalizeReconnectAttempts(maxReconnectAttempts)

  while (true) {
    throwIfAborted(signal)
    attempts += 1

    try {
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      }
      if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId

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

      onState?.('connected')
      const result = await consumeResponse({ response, signal, lastSequence, onEvent })
      lastSequence = result.lastSequence
      if (result.lastEventId !== undefined) lastEventId = result.lastEventId
      if (result.terminal) return { status: 'terminal', lastEventId: lastEventId ?? String(lastSequence) }
      throw new AgentStreamRetryableError('Agent event stream ended before a terminal event')
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw abortError()
      if (isControlledFailure(error)) throw error
      if (reconnects >= maximumReconnects) {
        return { status: 'exhausted', attempts, ...(lastEventId !== undefined ? { lastEventId } : {}) }
      }

      reconnects += 1
      onState?.('retrying')
      await waitForAbort(sleep(retryDelay(reconnects), signal), signal)
    }
  }
}
