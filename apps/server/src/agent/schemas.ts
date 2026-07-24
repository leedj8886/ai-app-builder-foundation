import { z } from 'zod';
import { agentRunModes } from './types';

export const objectIdStringSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId');

export const objectIdParamSchema = <TName extends string>(name: TName) =>
  z.object({
    [name]: objectIdStringSchema
  } as Record<TName, typeof objectIdStringSchema>);

export const createAgentRunRequestSchema = z.object({
  projectId: objectIdStringSchema,
  chatId: objectIdStringSchema.optional(),
  prompt: z.string().trim().min(1),
  mode: z.enum(agentRunModes).default('create')
});

export const streamTokenRequestSchema = z.object({
  runId: objectIdStringSchema,
  lastEventId: z.coerce.number().int().nonnegative().optional()
});

export type CreateAgentRunRequest = z.infer<typeof createAgentRunRequestSchema>;
