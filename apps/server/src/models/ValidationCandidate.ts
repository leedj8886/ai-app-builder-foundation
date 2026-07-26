import mongoose, { Schema, Types } from 'mongoose';
import {
  ProjectFile,
  ProjectSnapshotPackageJson,
  projectFileLanguages
} from '../agent/types';

export interface IValidationCandidate {
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  sourceRunId: Types.ObjectId;
  files: ProjectFile[];
  packageJson: ProjectSnapshotPackageJson;
  summary: string;
  expiresAt: Date;
  createdAt: Date;
}

const ValidationCandidateSchema = new Schema<IValidationCandidate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sourceRunId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentRun',
      required: true
    },
    files: {
      type: [{
        path: { type: String, required: true },
        content: { type: String, required: true },
        language: {
          type: String,
          enum: projectFileLanguages,
          required: true
        },
        generatedByRunId: { type: Schema.Types.ObjectId, ref: 'AgentRun' }
      }],
      required: true
    },
    packageJson: {
      dependencies: { type: Map, of: String, required: true },
      devDependencies: { type: Map, of: String, required: true },
      scripts: { type: Map, of: String, required: true }
    },
    summary: { type: String, required: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ValidationCandidateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ValidationCandidateSchema.index({ userId: 1, sourceRunId: 1 });

export const ValidationCandidate =
  (mongoose.models.ValidationCandidate as
    mongoose.Model<IValidationCandidate> | undefined) ||
  mongoose.model<IValidationCandidate>(
    'ValidationCandidate',
    ValidationCandidateSchema
  );
