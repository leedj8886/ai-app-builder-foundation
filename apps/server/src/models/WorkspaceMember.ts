import mongoose, { Schema, Types } from 'mongoose';

export interface IWorkspaceMember {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMemberSchema = new Schema<IWorkspaceMember>({
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'member'],
    required: true
  }
}, { timestamps: true });

WorkspaceMemberSchema.index(
  { workspaceId: 1, userId: 1 },
  { unique: true }
);
WorkspaceMemberSchema.index({ userId: 1, workspaceId: 1 });

export const WorkspaceMember =
  (mongoose.models.WorkspaceMember as
    mongoose.Model<IWorkspaceMember> | undefined) ||
  mongoose.model<IWorkspaceMember>(
    'WorkspaceMember',
    WorkspaceMemberSchema
  );
