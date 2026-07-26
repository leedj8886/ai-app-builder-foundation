import mongoose, { Schema, Types } from 'mongoose';
export interface IValidationCandidate {
  workspaceId: Types.ObjectId;
  branchId: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  sourceRunId: Types.ObjectId;
  artifactId: string;
  summary: string;
  expiresAt: Date;
  createdAt: Date;
}

const ValidationCandidateSchema = new Schema<IValidationCandidate>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'ProjectBranch', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sourceRunId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentRun',
      required: true
    },
    artifactId: { type: String, required: true, trim: true },
    summary: { type: String, required: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ValidationCandidateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ValidationCandidateSchema.index({ userId: 1, sourceRunId: 1 });
ValidationCandidateSchema.index({ artifactId: 1 });
ValidationCandidateSchema.index({ sourceRunId: 1 }, { unique: true });

export const ValidationCandidate =
  (mongoose.models.ValidationCandidate as
    mongoose.Model<IValidationCandidate> | undefined) ||
  mongoose.model<IValidationCandidate>(
    'ValidationCandidate',
    ValidationCandidateSchema
  );
