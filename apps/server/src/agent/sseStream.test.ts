import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type PublicAgentEvent,
  streamAgentRunEvents,
  type StreamAgentRunEventsInput
} from './sseStream';

const event = (sequence: number): PublicAgentEvent => ({
  id: `event-${sequence}`,
  runId: 'run-1',
  sequence,
  type: 'agent.step',
  message: `Event ${sequence}`,
  createdAt: '2026-07-24T00:00:00.000Z'
});

class FakeRequest {
  private closeListeners: Array<() => void> = [];

  on(eventName: string, listener: () => void): this {
    if (eventName === 'close') this.closeListeners.push(listener);
    return this;
  }

  close(): void {
    for (const listener of this.closeListeners) listener();
  }
}

class FakeResponse {
  readonly writes: string[] = [];
  endCalls = 0;
  throwOnWrite?: (chunk: string) => boolean;

  write(chunk: string): boolean {
    if (this.throwOnWrite?.(chunk)) throw new Error('write failed');
    this.writes.push(chunk);
    return true;
  }

  end(): void {
    this.endCalls += 1;
  }
}

class FakeSubscriber {
  readonly subscriptions: string[] = [];
  readonly calls: string[] = [];
  quitCalls = 0;
  private listeners = new Set<(channel: string, message: string) => void>();
  onSubscribe?: () => void;
  subscribeGate?: Promise<void>;

  on(eventName: string, listener: (channel: string, message: string) => void): this {
    if (eventName === 'message') {
      this.calls.push('listener-attached');
      this.listeners.add(listener);
    }
    return this;
  }

  off(eventName: string, listener: (channel: string, message: string) => void): this {
    if (eventName === 'message') this.listeners.delete(listener);
    return this;
  }

  async subscribe(...channels: Array<string | Buffer>): Promise<number> {
    this.calls.push('subscribe-started');
    this.subscriptions.push(String(channels[0]));
    this.onSubscribe?.();
    await this.subscribeGate;
    this.calls.push('subscribe-resolved');
    return 1;
  }

  async quit(): Promise<'OK'> {
    this.quitCalls += 1;
    return 'OK';
  }

  publish(value: unknown): void {
    const message = typeof value === 'string' ? value : JSON.stringify(value);
    for (const listener of this.listeners) listener('agent-run:run-1', message);
  }
}

const streamedSequences = (res: FakeResponse): number[] =>
  res.writes
    .filter((chunk) => chunk.startsWith('id: '))
    .map((chunk) => Number(chunk.slice(4).split('\n', 1)[0]));

const stream = async (
  overrides: Partial<StreamAgentRunEventsInput> = {}
): Promise<{ req: FakeRequest; res: FakeResponse; subscriber: FakeSubscriber }> => {
  const req = new FakeRequest();
  const res = new FakeResponse();
  const subscriber = new FakeSubscriber();

  await streamAgentRunEvents({
    runId: 'run-1',
    userId: 'user-1',
    req,
    res,
    subscriber,
    loadEvents: async () => [],
    heartbeatMs: 60_000,
    ...overrides
  });

  return { req, res, subscriber };
};

test('buffers a live event received while the durable backlog is loading', async () => {
  let releaseSubscribe!: () => void;
  let loadStarted = false;
  let notifyLoadStarted!: () => void;
  let releaseBacklog!: (events: PublicAgentEvent[]) => void;
  const subscribeGate = new Promise<void>((resolve) => {
    releaseSubscribe = resolve;
  });
  const backlog = new Promise<PublicAgentEvent[]>((resolve) => {
    releaseBacklog = resolve;
  });
  const loadStartedPromise = new Promise<void>((resolve) => {
    notifyLoadStarted = resolve;
  });
  const subscriber = new FakeSubscriber();
  subscriber.subscribeGate = subscribeGate;
  subscriber.onSubscribe = () => subscriber.publish(event(3));
  const req = new FakeRequest();
  const res = new FakeResponse();

  const streaming = streamAgentRunEvents({
    runId: 'run-1',
    userId: 'user-1',
    req,
    res,
    subscriber,
    loadEvents: async () => {
      loadStarted = true;
      notifyLoadStarted();
      return backlog;
    },
    heartbeatMs: 60_000
  });

  try {
    await Promise.resolve();
    assert.deepEqual(subscriber.calls, ['listener-attached', 'subscribe-started']);
    assert.equal(loadStarted, false);
    releaseSubscribe();
    await loadStartedPromise;
    assert.deepEqual(subscriber.calls, [
      'listener-attached',
      'subscribe-started',
      'subscribe-resolved'
    ]);
    assert.equal(loadStarted, true);
    releaseBacklog([event(1), event(2)]);
    await streaming;

    assert.deepEqual(streamedSequences(res), [1, 2, 3]);
  } finally {
    releaseSubscribe();
    releaseBacklog([]);
    req.close();
    await streaming;
  }
});

test('loads only durable events strictly after Last-Event-ID', async () => {
  let receivedLastEventId: number | undefined;
  const { req, res } = await stream({
    lastEventId: 3,
    loadEvents: async ({ lastEventId }) => {
      receivedLastEventId = lastEventId;
      return [event(4), event(5)];
    }
  });

  assert.equal(receivedLastEventId, 3);
  assert.deepEqual(streamedSequences(res), [4, 5]);
  req.close();
});

test('deduplicates stale and repeated live events after the backlog', async () => {
  const { req, res, subscriber } = await stream({
    loadEvents: async () => [event(1), event(2), event(3), event(4), event(5)]
  });

  subscriber.publish(event(5));
  subscriber.publish(event(4));
  subscriber.publish(event(6));

  assert.deepEqual(streamedSequences(res), [1, 2, 3, 4, 5, 6]);
  req.close();
});

test('writes heartbeats and closes its timer and subscriber exactly once', async () => {
  const { req, res, subscriber } = await stream({ heartbeatMs: 5 });

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(res.writes.includes(': heartbeat\n\n'));

  const writesBeforeClose = res.writes.length;
  req.close();
  req.close();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await Promise.resolve();
  assert.equal(subscriber.quitCalls, 1);
  assert.equal(res.writes.length, writesBeforeClose);
});

test('ignores malformed live messages and still cleans up', async () => {
  const { req, res, subscriber } = await stream();

  subscriber.publish('{not json');
  subscriber.publish({ ...event(2), sequence: 'not-a-number' });
  subscriber.publish(event(3));

  assert.deepEqual(streamedSequences(res), [3]);
  req.close();
  await Promise.resolve();
  assert.equal(subscriber.quitCalls, 1);
});

test('ends the stream exactly once when a live event write fails', async () => {
  const { req, res, subscriber } = await stream();
  res.throwOnWrite = (chunk) => chunk.startsWith('id: ');

  subscriber.publish(event(1));
  await Promise.resolve();

  assert.equal(res.endCalls, 1);
  assert.equal(subscriber.quitCalls, 1);
  req.close();
  assert.equal(res.endCalls, 1);
  assert.equal(subscriber.quitCalls, 1);
});

test('ends the stream exactly once when a heartbeat write fails', async () => {
  const { req, res, subscriber } = await stream({ heartbeatMs: 5 });
  res.throwOnWrite = (chunk) => chunk === ': heartbeat\n\n';

  await new Promise((resolve) => setTimeout(resolve, 15));
  const endCallsBeforeClose = res.endCalls;
  const quitCallsBeforeClose = subscriber.quitCalls;
  req.close();

  assert.equal(endCallsBeforeClose, 1);
  assert.equal(quitCallsBeforeClose, 1);
  assert.equal(res.endCalls, 1);
  assert.equal(subscriber.quitCalls, 1);
});
