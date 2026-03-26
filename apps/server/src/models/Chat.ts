import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  codeBlocks?: ICodeBlock[];
  createdAt: Date;
}

export interface ICodeBlock {
  id: string;
  language: string;
  code: string;
  fileName: string;
  dependencies?: string[];
}

export interface IChat extends Document {
  userId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  title: string;
  messages: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const CodeBlockSchema = new Schema<ICodeBlock>({
  id: { type: String, required: true },
  language: { type: String, required: true },
  code: { type: String, required: true },
  fileName: { type: String, required: true },
  dependencies: [{ type: String }]
});

const MessageSchema = new Schema<IMessage>({
  id: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  codeBlocks: [CodeBlockSchema],
  createdAt: { type: Date, default: Date.now }
});

const ChatSchema = new Schema<IChat>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project'
  },
  title: {
    type: String,
    required: true,
    default: 'New Chat'
  },
  messages: [MessageSchema]
}, {
  timestamps: true
});

// Index for efficient queries
ChatSchema.index({ userId: 1, updatedAt: -1 });
ChatSchema.index({ projectId: 1 });

export const Chat = mongoose.model<IChat>('Chat', ChatSchema);
