import { AgentEvent } from '../models/AgentEvent';
import { agentRunChannel, serializeAgentEvent } from './eventBus';
import { AgentEventType } from './types';

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
}

const DEFAULT_HEARTBEAT_MS = 15_000;

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
  heartbeatMs = DEFAULT_HEARTBEAT_MS
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
    subscriber.off('message', messageHandler);
    void subscriber.quit().catch(() => undefined);
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
    await subscriber.subscribe(agentRunChannel(runId));
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
