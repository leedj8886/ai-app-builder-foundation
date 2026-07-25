import { AgentEvent } from '../models/AgentEvent';
import { agentRunChannel, serializeAgentEvent } from './eventBus';
import { agentEventTypes, AgentEventType } from './types';

export interface PublicAgentEvent {
  id: string;
  runId: string;
  sequence: number;
  type: AgentEventType;
  message: string;
  payload?: unknown;
  createdAt: string;
}

export interface StreamRequest {
  on(event: 'close', listener: () => void): unknown;
}

export interface StreamResponse {
  write(chunk: string): boolean;
  end(): unknown;
  on?(event: 'error', listener: () => void): unknown;
}

export interface RedisSubscriber {
  subscribe(...channels: Array<string | Buffer>): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  off(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

export interface StreamAgentRunEventsInput {
  runId: string;
  userId: string;
  lastEventId?: number;
  req: StreamRequest;
  res: StreamResponse;
  subscriber: RedisSubscriber;
  loadEvents?: (input: {
    runId: string;
    userId: string;
    lastEventId?: number;
  }) => Promise<PublicAgentEvent[]>;
  heartbeatMs?: number;
  subscribeTimeoutMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_SUBSCRIBE_TIMEOUT_MS = 5_000;
const publicAgentEventTypes = new Set<string>(agentEventTypes);

const loadDurableEvents = async ({
  runId,
  userId,
  lastEventId
}: {
  runId: string;
  userId: string;
  lastEventId?: number;
}): Promise<PublicAgentEvent[]> => {
  const events = await AgentEvent.find({
    runId,
    userId,
    ...(lastEventId !== undefined && { sequence: { $gt: lastEventId } })
  }).sort({ sequence: 1 });

  return events.map(serializeAgentEvent);
};

const isPublicAgentEvent = (value: unknown, runId: string): value is PublicAgentEvent => {
  if (!value || typeof value !== 'object') return false;

  const event = value as Partial<PublicAgentEvent>;
  return (
    typeof event.id === 'string' &&
    event.runId === runId &&
    typeof event.sequence === 'number' &&
    Number.isInteger(event.sequence) &&
    event.sequence >= 0 &&
    typeof event.type === 'string' &&
    publicAgentEventTypes.has(event.type) &&
    typeof event.message === 'string' &&
    typeof event.createdAt === 'string'
  );
};

const toSseFrame = (event: PublicAgentEvent): string =>
  `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export const streamAgentRunEvents = async ({
  runId,
  userId,
  lastEventId,
  req,
  res,
  subscriber,
  loadEvents = loadDurableEvents,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  subscribeTimeoutMs = DEFAULT_SUBSCRIBE_TIMEOUT_MS
}: StreamAgentRunEventsInput): Promise<void> => {
  let closed = false;
  let backlogLoaded = false;
  let lastWrittenSequence = lastEventId ?? 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const bufferedEvents: PublicAgentEvent[] = [];

  const messageHandler = (_channel: string, message: string): void => {
    let event: unknown;

    try {
      event = JSON.parse(message);
    } catch {
      return;
    }

    if (!isPublicAgentEvent(event, runId) || closed) return;

    if (!backlogLoaded) {
      bufferedEvents.push(event);
      return;
    }

    writeEvent(event);
  };

  const cleanup = (): void => {
    if (closed) return;

    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    try {
      subscriber.off('message', messageHandler);
    } catch {
      // Cleanup must still close the response and Redis subscriber.
    }
    try {
      res.end();
    } catch {
      // The client may already have disconnected.
    }
    try {
      void subscriber.quit().catch(() => undefined);
    } catch {
      // Redis can already be disconnected.
    }
  };

  const writeEvent = (event: PublicAgentEvent): void => {
    if (closed || event.sequence <= lastWrittenSequence) return;

    try {
      res.write(toSseFrame(event));
      lastWrittenSequence = event.sequence;
    } catch {
      cleanup();
    }
  };

  const writeHeartbeat = (): void => {
    if (closed) return;

    try {
      res.write(': heartbeat\n\n');
    } catch {
      cleanup();
    }
  };

  subscriber.on('message', messageHandler);
  req.on('close', cleanup);
  res.on?.('error', cleanup);

  try {
    let subscribeTimeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      subscribeTimeout = setTimeout(() => {
        reject(new Error('Timed out subscribing to agent event stream'));
      }, subscribeTimeoutMs);
    });

    try {
      await Promise.race([subscriber.subscribe(agentRunChannel(runId)), timedOut]);
    } finally {
      if (subscribeTimeout) clearTimeout(subscribeTimeout);
    }
    if (closed) return;

    heartbeat = setInterval(writeHeartbeat, heartbeatMs);
    const durableEvents = await loadEvents({ runId, userId, lastEventId });
    if (closed) return;

    for (const event of [...durableEvents, ...bufferedEvents].sort((a, b) => a.sequence - b.sequence)) {
      writeEvent(event);
    }
    backlogLoaded = true;
  } catch (error) {
    cleanup();
    throw error;
  }
};
