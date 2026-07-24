import { Types } from 'mongoose';
import { AgentEvent } from '../models/AgentEvent';
import { getSharedRedisConnection } from './redis';
import { AgentEventType } from './types';

export interface EmitAgentEventInput {
  runId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
  projectId: string | Types.ObjectId;
  type: AgentEventType;
  message: string;
  payload?: unknown;
}

export interface SerializedAgentEvent {
  id: string;
  runId: string;
  sequence: number;
  type: AgentEventType;
  message: string;
  payload?: unknown;
  createdAt: string;
}

interface SerializableAgentEvent {
  _id: { toString(): string };
  runId: { toString(): string };
  sequence: number;
  type: AgentEventType;
  message: string;
  payload?: unknown;
  createdAt: Date;
}

export const agentRunChannel = (runId: string): string => `agent-run:${runId}`;

export const serializeAgentEvent = (
  event: SerializableAgentEvent
): SerializedAgentEvent => ({
  id: event._id.toString(),
  runId: event.runId.toString(),
  sequence: event.sequence,
  type: event.type,
  message: event.message,
  payload: event.payload,
  createdAt: event.createdAt.toISOString()
});

const toObjectId = (value: string | Types.ObjectId): Types.ObjectId =>
  typeof value === 'string' ? new Types.ObjectId(value) : value;

const getNextSequence = async (runId: Types.ObjectId): Promise<number> => {
  const latestEvent = await AgentEvent.findOne({ runId })
    .sort({ sequence: -1 })
    .select('sequence');

  return latestEvent ? latestEvent.sequence + 1 : 1;
};

export const emitAgentEvent = async (
  input: EmitAgentEventInput
): Promise<SerializedAgentEvent> => {
  const runId = toObjectId(input.runId);
  const event = await AgentEvent.create({
    runId,
    userId: toObjectId(input.userId),
    projectId: toObjectId(input.projectId),
    type: input.type,
    sequence: await getNextSequence(runId),
    message: input.message,
    payload: input.payload
  });

  const serialized = serializeAgentEvent(event);
  await getSharedRedisConnection().publish(
    agentRunChannel(runId.toString()),
    JSON.stringify(serialized)
  );

  return serialized;
};
