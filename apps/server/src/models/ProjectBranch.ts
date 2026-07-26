import mongoose, { Schema, Types } from 'mongoose';

export interface IProjectBranch {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  status: 'active' | 'archived';
  headSnapshotId?: Types.ObjectId;
  headVersion: number;
  createdFromSnapshotId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectBranchSchema = new Schema<IProjectBranch>({
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
  name: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['active', 'archived'],
    required: true,
    default: 'active'
  },
  headSnapshotId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectSnapshot'
  },
  headVersion: { type: Number, required: true, default: 0 },
  createdFromSnapshotId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectSnapshot'
  }
}, { timestamps: true });

ProjectBranchSchema.index(
  { projectId: 1, name: 1 },
  { unique: true }
);
ProjectBranchSchema.index({
  workspaceId: 1,
  projectId: 1,
  updatedAt: -1
});

export const ProjectBranch =
  (mongoose.models.ProjectBranch as
    mongoose.Model<IProjectBranch> | undefined) ||
  mongoose.model<IProjectBranch>('ProjectBranch', ProjectBranchSchema);
