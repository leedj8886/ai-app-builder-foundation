import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  chatIds: mongoose.Types.ObjectId[];
  activeSnapshotId?: mongoose.Types.ObjectId;
  activeSnapshotRevision: number;
  settings: {
    framework: 'react' | 'vue' | 'svelte';
    styling: 'tailwind' | 'css-modules' | 'styled-components';
    uiLibrary: 'shadcn' | 'mui' | 'antd' | 'none';
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
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
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
ProjectSchema.index({ userId: 1, updatedAt: -1 });

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
