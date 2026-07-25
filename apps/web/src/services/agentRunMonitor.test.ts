import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentRunDetailResponse } from './api'
import { AgentStreamHttpError } from './agentEventStream'
import { monitorAgentRun, type MonitorAgentRunOptions } from './agentRunMonitor'

const runningDetail = (): AgentRunDetailResponse => ({
  run: { _id: 'run_123', projectId: 'project_123', prompt: 'Build an app', mode: 'create', status: 'running' },
  events: [],
  resultSnapshot: null,
})

const completedDetail = (): AgentRunDetailResponse => ({
  ...runningDetail(),
  run: { ...runningDetail().run, status: 'completed' },
})

const rejectsPromptlyAfterAbort = async (promise: Promise<unknown>): Promise<void> => {
  await assert.rejects(
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('monitor did not abort promptly')), 25)),
    ]),
    { name: 'AbortError' },
  )
}

const options = (overrides: Partial<MonitorAgentRunOptions> = {}): MonitorAgentRunOptions => ({
  runId: 'run_123',
  token: 'token_123',
  signal: new AbortController().signal,
  onEvent: () => undefined,
  stream: async () => ({ outcome: 'terminal', lastEventId: 2 }),
  getRun: async () => ({ data: completedDetail() }),
  delay: async () => undefined,
  ...overrides,
})

describe('monitorAgentRun', () => {
  it('returns one final detail fetch after a terminal stream without polling', async () => {
    const events: string[] = []
    let getRunCalls = 0
    const detail = await monitorAgentRun(options({
      stream: async ({ onEvent }) => {
        onEvent({ sequence: 1, type: 'run.started', message: 'started' })
        onEvent({ sequence: 2, type: 'run.completed', message: 'done' })
        return { outcome: 'terminal', lastEventId: 2 }
      },
      onEvent: (event) => { events.push(event.type) },
      getRun: async () => {
        getRunCalls += 1
        return { data: completedDetail() }
      },
    }))

    assert.deepEqual(events, ['run.started', 'run.completed'])
    assert.equal(getRunCalls, 1)
    assert.equal(detail.run.status, 'completed')
  })

  it('starts bounded polling only after an exhausted stream and returns its terminal detail', async () => {
    let getRunCalls = 0
    let delays = 0
    const detail = await monitorAgentRun(options({
      stream: async () => ({ outcome: 'exhausted' }),
      getRun: async () => {
        getRunCalls += 1
        return { data: getRunCalls === 1 ? runningDetail() : completedDetail() }
      },
      delay: async () => { delays += 1 },
    }))

    assert.equal(getRunCalls, 2)
    assert.equal(delays, 1)
    assert.equal(detail.run.status, 'completed')
  })

  it('propagates aborts from streaming, polling, and fallback delays without continuing', async () => {
    const streamController = new AbortController()
    const streamPromise = monitorAgentRun(options({
      signal: streamController.signal,
      stream: async ({ signal }) => await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      }),
    }))
    streamController.abort()
    await assert.rejects(streamPromise, { name: 'AbortError' })

    const pollController = new AbortController()
    let pollCalls = 0
    await assert.rejects(
      monitorAgentRun(options({
        signal: pollController.signal,
        stream: async () => ({ outcome: 'exhausted' }),
        getRun: async () => {
          pollCalls += 1
          pollController.abort()
          return { data: runningDetail() }
        },
      })),
      { name: 'AbortError' },
    )
    assert.equal(pollCalls, 1)

    const delayController = new AbortController()
    let delayCalls = 0
    await assert.rejects(
      monitorAgentRun(options({
        signal: delayController.signal,
        stream: async () => ({ outcome: 'exhausted' }),
        getRun: async () => ({ data: runningDetail() }),
        delay: async () => {
          delayCalls += 1
          delayController.abort()
        },
      })),
      { name: 'AbortError' },
    )
    assert.equal(delayCalls, 1)

    const hangingPollController = new AbortController()
    let pollStarted!: () => void
    const pollStartedPromise = new Promise<void>((resolve) => { pollStarted = resolve })
    const hangingPoll = monitorAgentRun(options({
      signal: hangingPollController.signal,
      stream: async () => ({ outcome: 'exhausted' }),
      getRun: async () => {
        pollStarted()
        return await new Promise(() => undefined)
      },
    }))
    await pollStartedPromise
    hangingPollController.abort()
    await rejectsPromptlyAfterAbort(hangingPoll)

    const hangingDelayController = new AbortController()
    let delayStarted!: () => void
    const delayStartedPromise = new Promise<void>((resolve) => { delayStarted = resolve })
    const hangingDelay = monitorAgentRun(options({
      signal: hangingDelayController.signal,
      stream: async () => ({ outcome: 'exhausted' }),
      getRun: async () => ({ data: runningDetail() }),
      delay: async () => {
        delayStarted()
        return await new Promise(() => undefined)
      },
    }))
    await delayStartedPromise
    hangingDelayController.abort()
    await rejectsPromptlyAfterAbort(hangingDelay)
  })

  it('propagates stream authorization, application, and protocol errors without polling', async () => {
    const errors = [
      new AgentStreamHttpError(401, ''),
      new AgentStreamHttpError(403, ''),
      new AgentStreamHttpError(404, ''),
      new Error('application callback failed'),
      new Error('Invalid agent event stream frame: invalid event fields'),
    ]

    for (const error of errors) {
      let getRunCalls = 0
      await assert.rejects(
        monitorAgentRun(options({
          stream: async () => { throw error },
          getRun: async () => {
            getRunCalls += 1
            return { data: completedDetail() }
          },
        })),
        (received: unknown) => received === error,
      )
      assert.equal(getRunCalls, 0)
    }
  })

  it('times out after 60 fallback attempts with 500ms delays', async () => {
    let getRunCalls = 0
    const delays: number[] = []
    await assert.rejects(
      monitorAgentRun(options({
        stream: async () => ({ outcome: 'exhausted' }),
        getRun: async () => {
          getRunCalls += 1
          return { data: runningDetail() }
        },
        delay: async (duration) => { delays.push(duration) },
      })),
      /Timed out waiting for agent run/,
    )
    assert.equal(getRunCalls, 60)
    assert.deepEqual(delays, Array.from({ length: 59 }, () => 500))
  })
})
