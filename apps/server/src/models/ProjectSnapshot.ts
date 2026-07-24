import mongoose, { Schema, Types } from 'mongoose';
import {
  ProjectFileLanguage,
  ProjectSnapshotPackageJson,
  ValidationResult,
  projectFileLanguages
} from '../agent/types';

export interface IProjectFile {
  path: string;
  content: string;
  language: ProjectFileLanguage;
  generatedByRunId?: Types.ObjectId;
}

export interface IProjectSnapshot {
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  sourceRunId: Types.ObjectId;
  parentSnapshotId?: Types.ObjectId;
  files: IProjectFile[];
  packageJson: ProjectSnapshotPackageJson;
  validation: ValidationResult;
  summary: string;
  createdAt: Date;
}

const ProjectFileSchema = new Schema<IProjectFile>(
  {
    path: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    language: {
      type: String,
      enum: projectFileLanguages,
      required: true
    },
    generatedByRunId: { type: Schema.Types.ObjectId, ref: 'AgentRun' }
  },
  { _id: false }
);

const PackageJsonSchema = new Schema<ProjectSnapshotPackageJson>(
  {
    dependencies: { type: Map, of: String, required: true, default: {} },
    devDependencies: { type: Map, of: String, required: true, default: {} },
    scripts: { type: Map, of: String, required: true, default: {} }
  },
  { _id: false }
);

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
            enum: ['install', 'type-check', 'build'],
            required: true
          },
          command: { type: String, required: true },
          exitCode: { type: Number, required: true },
          stdout: { type: String, required: true, default: '' },
          stderr: { type: String, required: true, default: '' },
          durationMs: { type: Number, required: true, default: 0 }
        }
      ],
      required: true,
      default: []
    }
  },
  { _id: false }
);

const ProjectSnapshotSchema = new Schema<IProjectSnapshot>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sourceRunId: { type: Schema.Types.ObjectId, ref: 'AgentRun', required: true },
    parentSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProjectSnapshot' },
    files: {
      type: [ProjectFileSchema],
      required: true,
      default: []
    },
    packageJson: { type: PackageJsonSchema, required: true },
    validation: { type: ValidationSchema, required: true },
    summary: { type: String, required: true, trim: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

ProjectSnapshotSchema.index({ projectId: 1, createdAt: -1 });
ProjectSnapshotSchema.index({ userId: 1, createdAt: -1 });
ProjectSnapshotSchema.index({ sourceRunId: 1 });

export const ProjectSnapshot =
  (mongoose.models.ProjectSnapshot as mongoose.Model<IProjectSnapshot> | undefined) ||
  mongoose.model<IProjectSnapshot>('ProjectSnapshot', ProjectSnapshotSchema);
