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
  bodyCancels?: number
}

const eventFrame = (
  sequence: number,
  type = 'agent.step',
  message = `event ${sequence}`,
  id = String(sequence),
): string =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ sequence, type, message })}\n\n`

const responseFromChunks = (
  chunks: Array<string | Uint8Array>,
  status = 200,
  cleanup?: ReaderCleanup,
  readError?: Error,
  contentType = 'text/event-stream',
): Response => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
  body: {
    cancel: async () => { if (cleanup) cleanup.bodyCancels = (cleanup.bodyCancels ?? 0) + 1 },
    getReader: () => {
      let index = 0
      return {
        read: async () => {
          if (index >= chunks.length) {
            if (readError) throw readError
            return { done: true, value: undefined }
          }
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
    const frame = eventFrame(7, 'agent.step', '进度 ✅')
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

    assert.deepEqual(received, [{ sequence: 7, type: 'agent.step', message: '进度 ✅' }])
    assert.deepEqual(result, { outcome: 'exhausted', lastEventId: 7 })
  })

  it('handles CRLF comments and multiline data before a controlled malformed-frame failure', async () => {
    const received: AgentEvent[] = []
    const cleanup = { cancelled: false, released: false }
    const body = [
      ': heartbeat\r\n\r\n',
      'id: 8\r\nevent: agent.step\r\ndata: {"sequence":8,"type":"agent.step",\r\ndata: "message":"joined"}\r\n\r\n',
      'id: 9\r\nevent: agent.step\r\ndata: not-json\r\n\r\n',
    ]

    await assert.rejects(
      streamAgentEvents(options(async () => responseFromChunks(body, 200, cleanup), {
        maxReconnectAttempts: 0,
        onEvent: (event) => { received.push(event) },
      })),
      /Invalid agent event stream frame/,
    )

    assert.deepEqual(received, [{ sequence: 8, type: 'agent.step', message: 'joined' }])
    assert.deepEqual(cleanup, { cancelled: true, released: true })
  })

  it('rejects invalid sequences, event fields, and SSE ids without retrying', async () => {
    const invalidFrames = [
      'id: 1\nevent: agent.step\ndata: {"sequence":1.5,"type":"agent.step","message":"bad"}\n\n',
      'id: -1\nevent: agent.step\ndata: {"sequence":-1,"type":"agent.step","message":"bad"}\n\n',
      'id: 1\nevent: agent.step\ndata: {"sequence":1,"type":3,"message":"bad"}\n\n',
      'id: 1\nevent: agent.step\ndata: {"sequence":1,"type":"agent.step","message":3}\n\n',
      'id: 1\nevent: agent.step\ndata: {"sequence":1,"type":"agent.step","message":"bad","payload":null}\n\n',
      'id: 1\nevent: agent.step\ndata: {"sequence":1,"type":"agent.step","message":"bad","payload":[]}\n\n',
      eventFrame(1, 'agent.step', 'bad', 'not-a-number'),
      eventFrame(1, 'agent.step', 'bad', '2'),
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

  it('preserves delivered progress when a later socket read fails', async () => {
    const requests: RequestInit[] = []
    const received: number[] = []
    let fetches = 0
    const result = await streamAgentEvents(options(async (_url, init) => {
      requests.push(init ?? {})
      fetches += 1
      return fetches === 1
        ? responseFromChunks([eventFrame(1)], 200, undefined, new Error('socket closed'))
        : responseFromChunks([eventFrame(1), eventFrame(2, 'run.completed', 'done')])
    }, {
      maxReconnectAttempts: 1,
      onEvent: (event) => { received.push(event.sequence) },
    }))

    assert.equal((requests[1]?.headers as Record<string, string>)['Last-Event-ID'], '1')
    assert.deepEqual(received, [1, 2])
    assert.deepEqual(result, { outcome: 'terminal', lastEventId: 2 })
  })

  it('parses bare-CR delimiters split across chunks', async () => {
    const frame = eventFrame(4, 'run.completed', 'done').replace(/\n/g, '\r')
    const delimiterStart = frame.length - 2
    const result = await streamAgentEvents(options(async () => responseFromChunks([
      frame.slice(0, delimiterStart + 1), frame.slice(delimiterStart + 1),
    ])))

    assert.deepEqual(result, { outcome: 'terminal', lastEventId: 4 })
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

  it('aborts a hanging asynchronous callback without returning terminal', async () => {
    const controller = new AbortController()
    const cleanup = { cancelled: false, released: false }
    let startCallback!: () => void
    const callbackStarted = new Promise<void>((resolve) => { startCallback = resolve })
    const promise = streamAgentEvents(options(async () => responseFromChunks([
      eventFrame(1, 'run.completed', 'done'),
    ], 200, cleanup), {
      signal: controller.signal,
      onEvent: async () => {
        startCallback()
        return await new Promise<never>(() => undefined)
      },
    }))

    await callbackStarted
    controller.abort()

    await assert.rejects(promise, { name: 'AbortError' })
    assert.deepEqual(cleanup, { cancelled: true, released: true })
  })

  it('propagates callback and state handler errors exactly once without retrying', async () => {
    const callbackError = new Error('callback failed')
    let callbackFetches = 0
    let callbacks = 0
    await assert.rejects(
      streamAgentEvents(options(async () => {
        callbackFetches += 1
        return responseFromChunks([eventFrame(1)])
      }, {
        onEvent: () => {
          callbacks += 1
          throw callbackError
        },
      })),
      (error: unknown) => error === callbackError,
    )
    assert.equal(callbackFetches, 1)
    assert.equal(callbacks, 1)

    const stateError = new Error('state failed')
    let stateFetches = 0
    let states = 0
    await assert.rejects(
      streamAgentEvents(options(async () => {
        stateFetches += 1
        return responseFromChunks([])
      }, {
        onState: () => {
          states += 1
          throw stateError
        },
      })),
      (error: unknown) => error === stateError,
    )
    assert.equal(stateFetches, 1)
    assert.equal(states, 1)
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

  it('cancels rejected response bodies exactly once before retrying or propagating', async () => {
    const fiveXxBodies = Array.from({ length: 3 }, () => ({ cancelled: false, released: false, bodyCancels: 0 }))
    let fetches = 0
    await streamAgentEvents(options(async () => {
      const cleanup = fiveXxBodies[fetches++]
      return responseFromChunks([], 503, cleanup)
    }, {
      maxReconnectAttempts: 2,
      sleep: async () => undefined,
    }))
    assert.equal(fetches, 3)
    assert.deepEqual(fiveXxBodies.map((cleanup) => cleanup.bodyCancels), [1, 1, 1])

    const invalidContentType = { cancelled: false, released: false, bodyCancels: 0 }
    await assert.rejects(
      streamAgentEvents(options(async () => responseFromChunks([], 200, invalidContentType, undefined, 'application/json'))),
      /not text\/event-stream/,
    )
    assert.equal(invalidContentType.bodyCancels, 1)

    const stateFailure = { cancelled: false, released: false, bodyCancels: 0 }
    const stateError = new Error('connected state failed')
    await assert.rejects(
      streamAgentEvents(options(async () => responseFromChunks([], 200, stateFailure), {
        onState: () => { throw stateError },
      })),
      (error: unknown) => error === stateError,
    )
    assert.equal(stateFailure.bodyCancels, 1)
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
