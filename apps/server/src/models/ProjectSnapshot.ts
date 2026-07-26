import mongoose, { Schema, Types } from 'mongoose';
import { ValidationResult } from '../agent/types';

export interface IProjectSnapshot {
  workspaceId: Types.ObjectId;
  branchId: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  sourceRunId: Types.ObjectId;
  parentSnapshotId?: Types.ObjectId;
  artifactId: string;
  validation: ValidationResult;
  summary: string;
  createdAt: Date;
}

const ValidationSchema = new Schema<ValidationResult>(
  {
    status: {
      type: String,
      enum: ['passed', 'failed', 'skipped'],
      required: true
    },
    checks: {
      type: [
        {
          name: {
            type: String,
            enum: ['structure', 'install', 'type-check', 'build'],
            required: true
          },
          phase: {
            type: String,
            enum: ['structure', 'dependencies', 'type-check', 'build']
          },
          status: {
            type: String,
            enum: ['passed', 'failed', 'retrying', 'skipped']
          },
          category: {
            type: String,
            enum: ['CODE_ERROR', 'DEPENDENCY_ERROR', 'INFRA_ERROR']
          },
          command: String,
          exitCode: Number,
          stdout: { type: String, default: '' },
          stderr: { type: String, default: '' },
          durationMs: { type: Number, required: true, default: 0 },
          cache: {
            type: String,
            enum: ['hit', 'miss', 'not-applicable'],
            default: 'not-applicable'
          },
          attempt: { type: Number, default: 0 }
        }
      ],
      required: true,
      default: []
    },
    category: {
      type: String,
      enum: ['CODE_ERROR', 'DEPENDENCY_ERROR', 'INFRA_ERROR']
    },
    retryable: Boolean
  },
  { _id: false }
);

const ProjectSnapshotSchema = new Schema<IProjectSnapshot>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'ProjectBranch', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sourceRunId: { type: Schema.Types.ObjectId, ref: 'AgentRun', required: true },
    parentSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProjectSnapshot' },
    artifactId: { type: String, required: true, trim: true },
    validation: { type: ValidationSchema, required: true },
    summary: { type: String, required: true, trim: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

ProjectSnapshotSchema.index({ projectId: 1, createdAt: -1 });
ProjectSnapshotSchema.index({ userId: 1, createdAt: -1 });
ProjectSnapshotSchema.index({ sourceRunId: 1 }, { unique: true });
ProjectSnapshotSchema.index({ artifactId: 1 });

export const ProjectSnapshot =
  (mongoose.models.ProjectSnapshot as mongoose.Model<IProjectSnapshot> | undefined) ||
  mongoose.model<IProjectSnapshot>('ProjectSnapshot', ProjectSnapshotSchema);
