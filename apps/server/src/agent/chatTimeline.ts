import { agentPlanSchema } from './schemas';
import type {
  AgentErrorPayload,
  AgentPlan,
  AgentRunStatus
} from './types';

type Identifier = string | { toString(): string };

export interface TimelineRunSource {
  _id: Identifier;
  prompt: string;
  status: AgentRunStatus;
  model: string;
  error?: AgentErrorPayload;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TimelineEventSource {
  type: string;
  sequence: number;
  message: string;
  payload?: unknown;
  createdAt: Date;
}

export interface TimelineSnapshotSource {
  _id: Identifier;
  summary: string;
}

export interface ChatTimelineEvent {
  type: string;
  sequence: number;
  message: string;
  payload?: unknown;
  createdAt: string;
}

export interface ChatTimelineTurn {
  runId: string;
  userMessage: {
    content: string;
    createdAt: string;
  };
  agent: {
    status: AgentRunStatus;
    model: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    planningDurationMs?: number;
    summary?: string;
    plan?: AgentPlan;
    events: ChatTimelineEvent[];
    error?: AgentErrorPayload;
  };
  snapshot?: {
    id: string;
    summary: string;
    changedFiles: string[];
  };
}

export interface TimelineCursorBoundary {
  createdAt: Date;
  id: string;
}

const invalidCursor = (): Error & { code: string } =>
  Object.assign(new Error('Invalid timeline cursor'), {
    code: 'INVALID_TIMELINE_CURSOR'
  });

export const encodeTimelineCursor = (
  boundary: TimelineCursorBoundary
): string => Buffer.from(JSON.stringify({
  createdAt: boundary.createdAt.toISOString(),
  id: boundary.id
}), 'utf8').toString('base64url');

export const decodeTimelineCursor = (
  cursor: string
): TimelineCursorBoundary => {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as { createdAt?: unknown; id?: unknown };
    const createdAt = new Date(String(parsed.createdAt));

    if (
      Number.isNaN(createdAt.getTime()) ||
      typeof parsed.id !== 'string' ||
      !/^[a-f\d]{24}$/i.test(parsed.id)
    ) {
      throw invalidCursor();
    }

    return { createdAt, id: parsed.id };
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'INVALID_TIMELINE_CURSOR'
    ) {
      throw error;
    }
    throw invalidCursor();
  }
};

const nonNegativeDuration = (
  start?: Date,
  end?: Date
): number | undefined => {
  if (!start || !end) return undefined;
  return Math.max(0, end.getTime() - start.getTime());
};

const planFromEvents = (
  events: TimelineEventSource[]
): { plan?: AgentPlan; event?: TimelineEventSource } => {
  for (const event of events) {
    if (event.type !== 'agent.plan') continue;
    const parsed = agentPlanSchema.safeParse(event.payload);
    if (parsed.success) return { plan: parsed.data, event };
  }
  return {};
};

const changedFilesFromEvents = (
  events: TimelineEventSource[]
): string[] => {
  const paths = new Set<string>();

  for (const event of events) {
    if (
      event.type !== 'file.changed' ||
      !event.payload ||
      typeof event.payload !== 'object'
    ) {
      continue;
    }
    const path = (event.payload as { path?: unknown }).path;
    if (typeof path === 'string' && path.trim()) paths.add(path);
  }

  return [...paths];
};

export const buildChatTimelineTurn = (
  input: {
    run: TimelineRunSource;
    events: TimelineEventSource[];
    snapshot?: TimelineSnapshotSource | null;
  }
): ChatTimelineTurn => {
  const events = [...input.events].sort(
    (left, right) => left.sequence - right.sequence
  );
  const planned = planFromEvents(events);
  const planningDurationMs = input.run.startedAt && planned.event
    ? nonNegativeDuration(input.run.startedAt, planned.event.createdAt)
    : undefined;
  const durationMs = nonNegativeDuration(
    input.run.startedAt,
    input.run.completedAt
  );
  const changedFiles = changedFilesFromEvents(events);

  return {
    runId: input.run._id.toString(),
    userMessage: {
      content: input.run.prompt,
      createdAt: input.run.createdAt.toISOString()
    },
    agent: {
      status: input.run.status,
      model: input.run.model,
      ...(input.run.startedAt
        ? { startedAt: input.run.startedAt.toISOString() }
        : {}),
      ...(input.run.completedAt
        ? { completedAt: input.run.completedAt.toISOString() }
        : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(planningDurationMs === undefined ? {} : { planningDurationMs }),
      ...(input.snapshot?.summary
        ? { summary: input.snapshot.summary }
        : planned.plan?.summary
          ? { summary: planned.plan.summary }
          : {}),
      ...(planned.plan ? { plan: planned.plan } : {}),
      events: events.map(event => ({
        type: event.type,
        sequence: event.sequence,
        message: event.message,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
        createdAt: event.createdAt.toISOString()
      })),
      ...(input.run.error ? { error: input.run.error } : {})
    },
    ...(input.snapshot ? {
      snapshot: {
        id: input.snapshot._id.toString(),
        summary: input.snapshot.summary,
        changedFiles
      }
    } : {})
  };
};
