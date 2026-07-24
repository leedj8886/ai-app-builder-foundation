import mongoose, { Schema, Types } from 'mongoose';
import { AgentEventType, agentEventTypes } from '../agent/types';

export interface IAgentEvent {
  runId: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  type: AgentEventType;
  sequence: number;
  message: string;
  payload?: unknown;
  createdAt: Date;
}

const AgentEventSchema = new Schema<IAgentEvent>({
  runId: { type: Schema.Types.ObjectId, ref: 'AgentRun', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  type: {
    type: String,
    enum: agentEventTypes,
    required: true
  },
  sequence: { type: Number, required: true },
  message: { type: String, required: true },
  payload: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

AgentEventSchema.index({ runId: 1, sequence: 1 }, { unique: true });
AgentEventSchema.index({ userId: 1, createdAt: -1 });

export const AgentEvent =
  (mongoose.models.AgentEvent as mongoose.Model<IAgentEvent> | undefined) ||
  mongoose.model<IAgentEvent>('AgentEvent', AgentEventSchema);
