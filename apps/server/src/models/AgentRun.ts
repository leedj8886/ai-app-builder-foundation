import mongoose, { Schema, Types } from 'mongoose';
import {
  AgentErrorPayload,
  AgentRunMode,
  AgentRunStatus,
  agentRunModes,
  agentRunStatuses
} from '../agent/types';

export interface IAgentRun {
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  chatId?: Types.ObjectId;
  prompt: string;
  status: AgentRunStatus;
  mode: AgentRunMode;
  baseSnapshotId?: Types.ObjectId;
  baseSnapshotRevision: number;
  resultSnapshotId?: Types.ObjectId;
  retryOfRunId?: Types.ObjectId;
  validationCandidateId?: Types.ObjectId;
  retryable?: boolean;
  attempt: number;
  maxRepairAttempts: number;
  model: string;
  error?: AgentErrorPayload;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AgentRunSchema = new Schema<IAgentRun>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
    prompt: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: agentRunStatuses,
      required: true,
      default: 'queued'
    },
    mode: {
      type: String,
      enum: agentRunModes,
      required: true,
      default: 'create'
    },
    baseSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProjectSnapshot' },
    baseSnapshotRevision: { type: Number, required: true, default: 0 },
    resultSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProjectSnapshot' },
    retryOfRunId: { type: Schema.Types.ObjectId, ref: 'AgentRun' },
    validationCandidateId: {
      type: Schema.Types.ObjectId,
      ref: 'ValidationCandidate'
    },
    retryable: { type: Boolean, default: false },
    attempt: { type: Number, required: true, default: 0 },
    maxRepairAttempts: { type: Number, required: true, default: 2 },
    model: { type: String, required: true },
    error: {
      code: String,
      message: String,
      details: Schema.Types.Mixed
    },
    usage: {
      inputTokens: Number,
      outputTokens: Number,
      totalTokens: Number
    },
    startedAt: Date,
    completedAt: Date
  },
  {
    timestamps: true
  }
);

AgentRunSchema.index({ userId: 1, updatedAt: -1 });
AgentRunSchema.index({ projectId: 1, updatedAt: -1 });
AgentRunSchema.index({ status: 1, updatedAt: 1 });
AgentRunSchema.index({ userId: 1, chatId: 1, createdAt: -1 });

export const AgentRun =
  (mongoose.models.AgentRun as mongoose.Model<IAgentRun> | undefined) ||
  mongoose.model<IAgentRun>('AgentRun', AgentRunSchema);
