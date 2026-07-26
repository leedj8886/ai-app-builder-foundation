import mongoose, { Schema, Types } from 'mongoose';

export interface WorkspaceExecutionLimits {
  maxConcurrentBuilds: number;
  maxRunningPreviews: number;
  maxCpu: number;
  maxMemoryMiB: number;
  maxDiskMiB: number;
  maxBuildsPerHour: number;
  maxBuildMinutesPerDay: number;
  maxArtifactBytes: number;
  maxLogBytesPerCommand: number;
  maxFilesPerSnapshot: number;
}

export interface IWorkspace {
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  createdByUserId: Types.ObjectId;
  executionLimits: WorkspaceExecutionLimits;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>({
  slug: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    required: true,
    default: 'active'
  },
  createdByUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  executionLimits: {
    maxConcurrentBuilds: { type: Number, required: true, default: 8 },
    maxRunningPreviews: { type: Number, required: true, default: 12 },
    maxCpu: { type: Number, required: true, default: 32 },
    maxMemoryMiB: { type: Number, required: true, default: 65_536 },
    maxDiskMiB: { type: Number, required: true, default: 131_072 },
    maxBuildsPerHour: { type: Number, required: true, default: 100 },
    maxBuildMinutesPerDay: { type: Number, required: true, default: 1_000 },
    maxArtifactBytes: {
      type: Number,
      required: true,
      default: 50 * 1024 * 1024 * 1024
    },
    maxLogBytesPerCommand: {
      type: Number,
      required: true,
      default: 5 * 1024 * 1024
    },
    maxFilesPerSnapshot: { type: Number, required: true, default: 5_000 }
  }
}, { timestamps: true });

export const Workspace =
  (mongoose.models.Workspace as mongoose.Model<IWorkspace> | undefined) ||
  mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);
