import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAgentEventStreamUrl, type AgentEvent } from './api'
import {
  AgentStreamHttpError,
  streamAgentEvents,
  type StreamAgentEventsOptions,
} from './agentEventStream'

const encoder = new TextEncoder()

interface ReaderCleanup {
  cancelled: boolean
  released: boolean
}

const eventFrame = (
  sequence: number,
  type = 'run.progress',
  message = `event ${sequence}`,
  id = String(sequence),
): string =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ sequence, type, message })}\n\n`

const responseFromChunks = (
  chunks: Array<string | Uint8Array>,
  status = 200,
  cleanup?: ReaderCleanup,
): Response => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
  body: {
    getReader: () => {
      let index = 0
      return {
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined }
          const chunk = chunks[index++]
          return { done: false, value: typeof chunk === 'string' ? encoder.encode(chunk) : chunk }
        },
        cancel: async () => { if (cleanup) cleanup.cancelled = true },
        releaseLock: () => { if (cleanup) cleanup.released = true },
      }
    },
  },
} as unknown as Response)

const options = (
  fetchImpl: NonNullable<StreamAgentEventsOptions['fetchImpl']>,
  overrides: Partial<StreamAgentEventsOptions> = {},
): StreamAgentEventsOptions => ({
  runId: 'run / one',
  token: 'token-123',
  signal: new AbortController().signal,
  fetchImpl,
  sleep: async () => undefined,
  onEvent: () => undefined,
  ...overrides,
})

describe('streamAgentEvents', () => {
  it('builds an encoded URL for empty and configured API bases', () => {
    assert.equal(buildAgentEventStreamUrl('', 'run / one'), '/api/agent/runs/run%20%2F%20one/events')
    assert.equal(buildAgentEventStreamUrl('https://api.example.test', 'run / one'), 'https://api.example.test/api/agent/runs/run%20%2F%20one/events')
    assert.equal(buildAgentEventStreamUrl('https://api.example.test/', 'run / one'), 'https://api.example.test/api/agent/runs/run%20%2F%20one/events')
  })

  it('parses a frame split inside a UTF-8 code point and preserves event fields', async () => {
    const received: AgentEvent[] = []
    const frame = eventFrame(7, 'run.progress', '进度 ✅')
    const encoded = encoder.encode(frame)
    const characterStart = encoder.encode(frame.slice(0, frame.indexOf('进'))).length
    const chunks = [
      encoded.slice(0, characterStart + 1),
      encoded.slice(characterStart + 1, characterStart + 2),
      encoded.slice(characterStart + 2),
    ]

    const result = await streamAgentEvents(options(async () => responseFromChunks(chunks), {
      maxReconnectAttempts: 0,
      onEvent: (event) => { received.push(event) },
    }))

    assert.deepEqual(received, [{ sequence: 7, type: 'run.progress', message: '进度 ✅' }])
    assert.deepEqual(result, { outcome: 'exhausted', lastEventId: 7 })
  })

  it('handles CRLF comments and multiline data before a controlled malformed-frame failure', async () => {
    const received: AgentEvent[] = []
    const cleanup = { cancelled: false, released: false }
    const body = [
      ': heartbeat\r\n\r\n',
      'id: 8\r\nevent: run.progress\r\ndata: {"sequence":8,"type":"run.progress",\r\ndata: "message":"joined"}\r\n\r\n',
      'id: 9\r\nevent: run.progress\r\ndata: not-json\r\n\r\n',
    ]

    await assert.rejects(
      streamAgentEvents(options(async () => responseFromChunks(body, 200, cleanup), {
        maxReconnectAttempts: 0,
        onEvent: (event) => { received.push(event) },
      })),
      /Invalid agent event stream frame/,
    )

    assert.deepEqual(received, [{ sequence: 8, type: 'run.progress', message: 'joined' }])
    assert.deepEqual(cleanup, { cancelled: true, released: true })
  })

  it('rejects invalid sequences, event fields, and SSE ids without retrying', async () => {
    const invalidFrames = [
      'id: 1\nevent: run.progress\ndata: {"sequence":1.5,"type":"run.progress","message":"bad"}\n\n',
      'id: -1\nevent: run.progress\ndata: {"sequence":-1,"type":"run.progress","message":"bad"}\n\n',
      'id: 1\nevent: run.progress\ndata: {"sequence":1,"type":3,"message":"bad"}\n\n',
      'id: 1\nevent: run.progress\ndata: {"sequence":1,"type":"run.progress","message":3}\n\n',
      eventFrame(1, 'run.progress', 'bad', 'not-a-number'),
      eventFrame(1, 'run.progress', 'bad', '2'),
    ]

    for (const frame of invalidFrames) {
      let fetches = 0
      const cleanup = { cancelled: false, released: false }
      await assert.rejects(
        streamAgentEvents(options(async () => {
          fetches += 1
          return responseFromChunks([frame], 200, cleanup)
        })),
        /Invalid agent event stream frame/,
      )
      assert.equal(fetches, 1)
      assert.deepEqual(cleanup, { cancelled: true, released: true })
    }
  })

  it('sends auth and Last-Event-ID only when resuming', async () => {
    const requests: RequestInit[] = []
    await streamAgentEvents(options(async (_url, init) => {
      requests.push(init ?? {})
      return responseFromChunks([])
    }, { lastEventId: 42, maxReconnectAttempts: 0 }))

    const resumedHeaders = requests[0]?.headers as Record<string, string>
    assert.equal(resumedHeaders.Authorization, 'Bearer token-123')
    assert.equal(resumedHeaders.Accept, 'text/event-stream')
    assert.equal(resumedHeaders['Last-Event-ID'], '42')

    await streamAgentEvents(options(async (_url, init) => {
      requests.push(init ?? {})
      return responseFromChunks([])
    }, { maxReconnectAttempts: 0 }))
    assert.equal('Last-Event-ID' in (requests[1]?.headers as Record<string, string>), false)
  })

  it('resumes from the most recently accepted event id after EOF', async () => {
    const requests: RequestInit[] = []
    let fetches = 0
    const result = await streamAgentEvents(options(async (_url, init) => {
      requests.push(init ?? {})
      fetches += 1
      return fetches === 1
        ? responseFromChunks([eventFrame(4)])
        : responseFromChunks([eventFrame(5, 'run.completed', 'done')])
    }, { maxReconnectAttempts: 1 }))

    assert.equal((requests[0]?.headers as Record<string, string>)['Last-Event-ID'], undefined)
    assert.equal((requests[1]?.headers as Record<string, string>)['Last-Event-ID'], '4')
    assert.deepEqual(result, { outcome: 'terminal', lastEventId: 5 })
  })

  it('ignores duplicate and out-of-order sequences', async () => {
    const received: number[] = []
    await streamAgentEvents(options(async () => responseFromChunks([
      eventFrame(2), eventFrame(2), eventFrame(1), eventFrame(3),
    ]), {
      maxReconnectAttempts: 0,
      onEvent: (event) => { received.push(event.sequence) },
    }))
    assert.deepEqual(received, [2, 3])
  })

  it('awaits asynchronous event callbacks in stream order', async () => {
    const callbacks: string[] = []
    await streamAgentEvents(options(async () => responseFromChunks([
      eventFrame(1), eventFrame(2, 'run.completed', 'done'),
    ]), {
      onEvent: async (event) => {
        callbacks.push(`start-${event.sequence}`)
        await Promise.resolve()
        callbacks.push(`end-${event.sequence}`)
      },
    }))
    assert.deepEqual(callbacks, ['start-1', 'end-1', 'start-2', 'end-2'])
  })

  it('aborts during fetch, reads, and backoff without another retry', async () => {
    const fetchController = new AbortController()
    let fetches = 0
    const pendingFetch = streamAgentEvents(options(async (_url, init) => {
      fetches += 1
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    }, { signal: fetchController.signal }))
    fetchController.abort()
    await assert.rejects(pendingFetch, { name: 'AbortError' })
    assert.equal(fetches, 1)

    const readController = new AbortController()
    const readCleanup = { cancelled: false, released: false }
    let startRead!: () => void
    const reading = new Promise<void>((resolve) => { startRead = resolve })
    const neverEndingResponse = {
      ok: true,
      status: 200,
      statusText: '',
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({
        read: async () => { startRead(); return await new Promise<never>(() => undefined) },
        cancel: async () => { readCleanup.cancelled = true },
        releaseLock: () => { readCleanup.released = true },
      }) },
    } as unknown as Response
    const pendingRead = streamAgentEvents(options(async () => neverEndingResponse, { signal: readController.signal }))
    await reading
    readController.abort()
    await assert.rejects(pendingRead, { name: 'AbortError' })
    assert.deepEqual(readCleanup, { cancelled: true, released: true })

    const backoffController = new AbortController()
    let backoffFetches = 0
    const pendingBackoff = streamAgentEvents(options(async () => {
      backoffFetches += 1
      throw new Error('offline')
    }, {
      signal: backoffController.signal,
      sleep: async (_duration, signal) => { backoffController.abort(); assert.equal(signal, backoffController.signal) },
    }))
    await assert.rejects(pendingBackoff, { name: 'AbortError' })
    assert.equal(backoffFetches, 1)
  })

  it('uses an abort-aware default backoff when sleep is not provided', async () => {
    const controller = new AbortController()
    let fetches = 0
    const promise = streamAgentEvents({
      runId: 'run-1',
      token: 'token-123',
      signal: controller.signal,
      fetchImpl: async () => {
        fetches += 1
        throw new Error('offline')
      },
      onEvent: () => undefined,
    })

    await Promise.resolve()
    controller.abort()

    await assert.rejects(promise, { name: 'AbortError' })
    assert.equal(fetches, 1)
  })

  it('retries EOF, network errors, and 5xx with 250/500/1000ms delays then exhausts', async () => {
    const sleeps: number[] = []
    let fetches = 0
    const result = await streamAgentEvents(options(async () => {
      fetches += 1
      if (fetches === 1) return responseFromChunks([])
      if (fetches === 2) throw new Error('network')
      return responseFromChunks([], 503)
    }, {
      maxReconnectAttempts: 3,
      sleep: async (duration) => { sleeps.push(duration) },
    }))
    assert.equal(fetches, 4)
    assert.deepEqual(sleeps, [250, 500, 1000])
    assert.deepEqual(result, { outcome: 'exhausted' })
  })

  it('does not retry 401, 403, or 404 responses', async () => {
    for (const status of [401, 403, 404]) {
      let fetches = 0
      await assert.rejects(
        streamAgentEvents(options(async () => {
          fetches += 1
          return responseFromChunks([], status)
        })),
        (error: unknown) => error instanceof AgentStreamHttpError && error.status === status,
      )
      assert.equal(fetches, 1)
    }
  })

  it('stops after terminal events and cleans up the reader', async () => {
    let fetches = 0
    const cleanup = { cancelled: false, released: false }
    const result = await streamAgentEvents(options(async () => {
      fetches += 1
      return responseFromChunks([eventFrame(12, 'run.cancelled', 'cancelled')], 200, cleanup)
    }))
    assert.equal(fetches, 1)
    assert.deepEqual(result, { outcome: 'terminal', lastEventId: 12 })
    assert.deepEqual(cleanup, { cancelled: true, released: true })
  })

  it('releases but does not cancel a reader after normal EOF', async () => {
    const cleanup = { cancelled: false, released: false }
    await streamAgentEvents(options(async () => responseFromChunks([], 200, cleanup), { maxReconnectAttempts: 0 }))
    assert.deepEqual(cleanup, { cancelled: false, released: true })
  })
})
