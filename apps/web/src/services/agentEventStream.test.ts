import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { agentEventStreamUrl, type AgentEvent } from './api'
import {
  AgentStreamHttpError,
  streamAgentEvents,
  type StreamAgentEventsOptions,
} from './agentEventStream'

const encoder = new TextEncoder()

const aborted = (): Error => {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const eventFrame = (
  sequence: number,
  type = 'run.progress',
  message = `event ${sequence}`,
): string =>
  `id: ${sequence}\nevent: ${type}\ndata: ${JSON.stringify({ sequence, type, message })}\n\n`

const responseFromChunks = (chunks: Array<string | Uint8Array>, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null,
    },
    body: {
      getReader: () => {
        let index = 0
        return {
          read: async () => index < chunks.length
            ? { done: false, value: typeof chunks[index] === 'string' ? encoder.encode(chunks[index++] as string) : chunks[index++] as Uint8Array }
            : { done: true, value: undefined },
          cancel: async () => undefined,
          releaseLock: () => undefined,
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
  fetchImpl,
  sleep: async () => undefined,
  onEvent: () => undefined,
  ...overrides,
})

describe('streamAgentEvents', () => {
  it('builds an encoded agent event stream URL', () => {
    assert.equal(agentEventStreamUrl('run / one'), '/api/agent/runs/run%20%2F%20one/events')
  })

  it('parses an SSE frame split across UTF-8 chunks and preserves its fields', async () => {
    const received: AgentEvent[] = []
    const frame = eventFrame(7, 'run.progress', '进度 ✅')
    const encoded = encoder.encode(frame)
    const chunks = [encoded.slice(0, 19), encoded.slice(19, 33), encoded.slice(33)]

    const result = await streamAgentEvents(options(async () => responseFromChunks(chunks), {
      maxReconnectAttempts: 0,
      onEvent: (event) => received.push(event),
    }))

    assert.deepEqual(received, [{ sequence: 7, type: 'run.progress', message: '进度 ✅' }])
    assert.deepEqual(result, { status: 'exhausted', attempts: 1, lastEventId: '7' })
  })

  it('handles CRLF frames, comments, and multiline data', async () => {
    const received: AgentEvent[] = []
    const body = [
      ': heartbeat\r\n',
      '\r\n',
      'id: 8\r\n',
      'event: run.progress\r\n',
      'data: {"sequence":8,"type":"run.progress",\r\n',
      'data: "message":"joined"}\r\n',
      '\r\n',
      'id: 9\r\n',
      'event: run.progress\r\n',
      'data: not-json\r\n',
      '\r\n',
    ]
    let fetches = 0

    await assert.rejects(
      streamAgentEvents(options(async () => {
        fetches += 1
        return responseFromChunks(body)
      }, {
        maxReconnectAttempts: 0,
        onEvent: (event) => received.push(event),
      })),
      /Invalid agent event stream frame/,
    )

    assert.equal(fetches, 1)
    assert.deepEqual(received, [{ sequence: 8, type: 'run.progress', message: 'joined' }])
  })

  it('sends auth and the accepted event id when resuming', async () => {
    const requests: RequestInit[] = []

    await streamAgentEvents(options(async (_url, init) => {
      requests.push(init ?? {})
      return responseFromChunks([])
    }, { lastEventId: '42' }))

    const headers = requests[0]?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer token-123')
    assert.equal(headers.Accept, 'text/event-stream')
    assert.equal(headers['Last-Event-ID'], '42')
  })

  it('omits Last-Event-ID when there is no accepted event', async () => {
    const requests: RequestInit[] = []

    await streamAgentEvents(options(async (_url, init) => {
      requests.push(init ?? {})
      return responseFromChunks([])
    }))

    const headers = requests[0]?.headers as Record<string, string>
    assert.equal('Last-Event-ID' in headers, false)
  })

  it('uses the most recently accepted id when reconnecting', async () => {
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
    assert.deepEqual(result, { status: 'terminal', lastEventId: '5' })
  })

  it('ignores duplicate and out-of-order sequences across frames', async () => {
    const received: number[] = []

    await streamAgentEvents(options(async () => responseFromChunks([
      eventFrame(2), eventFrame(2), eventFrame(1), eventFrame(3),
    ]), {
      onEvent: (event) => received.push(event.sequence),
    }))

    assert.deepEqual(received, [2, 3])
  })

  it('aborts promptly during fetch, without retries', async () => {
    const controller = new AbortController()
    let fetches = 0
    const pendingFetch: typeof fetch = async (_url, init) => {
      fetches += 1
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(aborted()), { once: true })
      })
    }
    const promise = streamAgentEvents(options(pendingFetch, { signal: controller.signal }))
    controller.abort()

    await assert.rejects(promise, { name: 'AbortError' })
    assert.equal(fetches, 1)
  })

  it('aborts promptly during stream reads, without retries', async () => {
    const controller = new AbortController()
    let fetches = 0
    let beginRead!: () => void
    const reading = new Promise<void>((resolve) => { beginRead = resolve })
    const unreadableResponse = {
      ok: true,
      status: 200,
      statusText: '',
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader: () => ({
          read: async () => {
            beginRead()
            return await new Promise<never>(() => undefined)
          },
          cancel: async () => undefined,
          releaseLock: () => undefined,
        }),
      },
    } as unknown as Response
    const promise = streamAgentEvents(options(async () => {
      fetches += 1
      return unreadableResponse
    }, { signal: controller.signal }))

    await reading
    controller.abort()

    await assert.rejects(promise, { name: 'AbortError' })
    assert.equal(fetches, 1)
  })

  it('aborts during retry backoff without another fetch', async () => {
    const controller = new AbortController()
    let fetches = 0
    const promise = streamAgentEvents(options(async () => {
      fetches += 1
      throw new Error('offline')
    }, {
      signal: controller.signal,
      sleep: async (_delay, signal) => {
        controller.abort()
        if (signal?.aborted) return
      },
    }))

    await assert.rejects(promise, { name: 'AbortError' })
    assert.equal(fetches, 1)
  })

  it('retries EOF, network errors, and 5xx with bounded exponential delays', async () => {
    const sleeps: number[] = []
    let fetches = 0
    const result = await streamAgentEvents(options(async () => {
      fetches += 1
      if (fetches === 1) return responseFromChunks([])
      if (fetches === 2) throw new Error('network')
      return responseFromChunks([], 503)
    }, {
      maxReconnectAttempts: 3,
      sleep: async (delay) => { sleeps.push(delay) },
    }))

    assert.equal(fetches, 4)
    assert.deepEqual(sleeps, [250, 500, 1000])
    assert.deepEqual(result, { status: 'exhausted', attempts: 4 })
  })

  it('does not retry authentication or missing-stream responses', async () => {
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

  it('returns terminal and stops reconnecting after a terminal event', async () => {
    let fetches = 0
    const result = await streamAgentEvents(options(async () => {
      fetches += 1
      return responseFromChunks([eventFrame(12, 'run.completed', 'done')])
    }))

    assert.equal(fetches, 1)
    assert.deepEqual(result, { status: 'terminal', lastEventId: '12' })
  })
})
