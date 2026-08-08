import { Schema } from 'mongoose';
import type { ProfileRef } from './types';
import { defaultProjectProfileRef } from './registry';

export const projectProfileRefSchema = new Schema<ProfileRef>(
  {
    id: {
      type: String,
      required: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    },
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger
    }
  },
  { _id: false }
);

export const projectProfileRefField = {
  type: projectProfileRefSchema,
  required: false
} as const;

export const defaultedProjectProfileRefField = {
  type: projectProfileRefSchema,
  required: true,
  default: defaultProjectProfileRef
} as const;
