import mongoose, { Schema, Document } from 'mongoose';
import type { ProfileRef } from '../agent/profiles/types';
import { defaultedProjectProfileRefField } from '../agent/profiles/schema';

export interface IProject extends Document {
  workspaceId?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  chatIds: mongoose.Types.ObjectId[];
  activeSnapshotId?: mongoose.Types.ObjectId;
  activeSnapshotRevision: number;
  profile: ProfileRef;
  sandboxLimits: {
    maxConcurrentBuilds: number;
    maxRunningPreviews: number;
  };
  settings: {
    framework: 'react' | 'vue' | 'svelte';
    styling: 'tailwind' | 'css-modules' | 'styled-components';
    uiLibrary: 'shadcn' | 'mui' | 'antd' | 'none';
    agentModelId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
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
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  chatIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Chat'
  }],
  activeSnapshotId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectSnapshot'
  },
  activeSnapshotRevision: {
    type: Number,
    required: true,
    default: 0
  },
  profile: defaultedProjectProfileRefField,
  sandboxLimits: {
    maxConcurrentBuilds: {
      type: Number,
      required: true,
      default: 2,
      min: 1
    },
    maxRunningPreviews: {
      type: Number,
      required: true,
      default: 3,
      min: 1
    }
  },
  settings: {
    framework: {
      type: String,
      enum: ['react', 'vue', 'svelte'],
      default: 'react'
    },
    styling: {
      type: String,
      enum: ['tailwind', 'css-modules', 'styled-components'],
      default: 'tailwind'
    },
    uiLibrary: {
      type: String,
      enum: ['shadcn', 'mui', 'antd', 'none'],
      default: 'shadcn'
    },
    agentModelId: {
      type: String,
      trim: true
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
ProjectSchema.index({ userId: 1, workspaceId: 1, updatedAt: -1 });

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
