import mongoose, { Schema, Types } from 'mongoose';

export interface IBranchExecutionLease {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  branchId: Types.ObjectId;
  runId: Types.ObjectId;
  baseHeadVersion: number;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
}

const BranchExecutionLeaseSchema =
  new Schema<IBranchExecutionLease>({
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectBranch',
      required: true
    },
    runId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentRun',
      required: true
    },
    baseHeadVersion: { type: Number, required: true },
    acquiredAt: { type: Date, required: true },
    heartbeatAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true }
  }, { timestamps: false });

BranchExecutionLeaseSchema.index({ branchId: 1 }, { unique: true });
BranchExecutionLeaseSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export const BranchExecutionLease =
  (mongoose.models.BranchExecutionLease as
    mongoose.Model<IBranchExecutionLease> | undefined) ||
  mongoose.model<IBranchExecutionLease>(
    'BranchExecutionLease',
    BranchExecutionLeaseSchema
  );
