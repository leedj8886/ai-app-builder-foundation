import mongoose, { Schema, Types } from 'mongoose';
import {
  AgentErrorPayload,
  AgentAttachment,
  AgentRunMode,
  AgentRunStatus,
  agentRunModes,
  agentRunStatuses
} from '../agent/types';
import type { ProfileRef } from '../agent/profiles/types';
import { projectProfileRefField } from '../agent/profiles/schema';

export interface IAgentRun {
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  projectId: Types.ObjectId;
  profile?: ProfileRef;
  branchId?: Types.ObjectId;
  chatId?: Types.ObjectId;
  prompt: string;
  attachments?: AgentAttachment[];
  status: AgentRunStatus;
  mode: AgentRunMode;
  baseSnapshotId?: Types.ObjectId;
  baseSnapshotRevision: number;
  baseHeadVersion?: number;
  resultSnapshotId?: Types.ObjectId;
  retryOfRunId?: Types.ObjectId;
  validationCandidateId?: Types.ObjectId;
  retryable?: boolean;
  attempt: number;
  maxRepairAttempts: number;
  modelId?: string;
  modelProvider?: string;
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
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    profile: projectProfileRefField,
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectBranch',
      required: true
    },
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
    prompt: { type: String, required: true, trim: true },
    attachments: [{
      _id: false,
      id: { type: String, required: true },
      name: { type: String, required: true },
      mediaType: { type: String, required: true },
      size: { type: Number, required: true },
      content: { type: String, required: true }
    }],
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
    baseHeadVersion: { type: Number, required: true },
    resultSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProjectSnapshot' },
    retryOfRunId: { type: Schema.Types.ObjectId, ref: 'AgentRun' },
    validationCandidateId: {
      type: Schema.Types.ObjectId,
      ref: 'ValidationCandidate'
    },
    retryable: { type: Boolean, default: false },
    attempt: { type: Number, required: true, default: 0 },
    maxRepairAttempts: { type: Number, required: true, default: 2 },
    modelId: { type: String, trim: true },
    modelProvider: { type: String, trim: true },
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
AgentRunSchema.index({ branchId: 1, createdAt: 1 });
AgentRunSchema.index(
  { retryOfRunId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      retryOfRunId: { $type: 'objectId' },
      status: {
        $in: [
          'waiting_for_capacity',
          'queued',
          'running',
          'planning',
          'generating',
          'validating',
          'repairing',
          'persisting'
        ]
      }
    }
  }
);

export const AgentRun =
  (mongoose.models.AgentRun as mongoose.Model<IAgentRun> | undefined) ||
  mongoose.model<IAgentRun>('AgentRun', AgentRunSchema);
