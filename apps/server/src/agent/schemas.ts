import { z } from 'zod';
import { agentRunModes } from './types';
import { modelIdSchema } from '../services/modelCatalog';

const safeProjectPathSchema = z.string().trim().min(1).refine(value => {
  const normalized = value.replace(/\\/g, '/');
  return !normalized.startsWith('/') &&
    !/^[a-zA-Z]:\//.test(normalized) &&
    normalized !== '..' &&
    !normalized.startsWith('../') &&
    !normalized.includes('/../') &&
    /\.(ts|tsx|js|cjs|mjs|css|json|html|md)$/.test(normalized);
}, 'File path must be a safe supported project path');

const dependencyMapSchema = z.record(z.string().trim().min(1));

export const MAX_AGENT_ATTACHMENT_COUNT = 5;
export const MAX_AGENT_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_AGENT_ATTACHMENTS_TOTAL_BYTES = 1024 * 1024;

export const agentAttachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160).refine(
    value => !/[\\/]/.test(value),
    'Attachment name cannot contain path separators'
  ),
  mediaType: z.string().trim().min(1).max(128).refine(
    value => value.startsWith('text/') || [
      'application/json',
      'application/javascript',
      'application/xml'
    ].includes(value),
    'Only text and code attachments are supported'
  ),
  size: z.number().int().nonnegative().max(MAX_AGENT_ATTACHMENT_BYTES),
  content: z.string().refine(
    value => !value.includes('\0')
      && Buffer.byteLength(value, 'utf8') <= MAX_AGENT_ATTACHMENT_BYTES,
    'Attachment must be text no larger than 512 KB'
  )
}).strict();

const agentAttachmentsSchema = z.array(agentAttachmentSchema)
  .max(MAX_AGENT_ATTACHMENT_COUNT)
  .superRefine((attachments, context) => {
    const totalBytes = attachments.reduce(
      (sum, attachment) => sum + Buffer.byteLength(attachment.content, 'utf8'),
      0
    );
    if (totalBytes > MAX_AGENT_ATTACHMENTS_TOTAL_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Attachments cannot exceed 1 MB in total'
      });
    }
  });

export const agentPlanSchema = z.object({
  summary: z.string().trim().min(1),
  steps: z.array(z.object({
    title: z.string().trim().min(1),
    intent: z.string().trim().min(1),
    filesLikelyTouched: z.array(safeProjectPathSchema)
  }).strict()).min(1),
  assumptions: z.array(z.string().trim().min(1))
}).strict();

const fileOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    path: safeProjectPathSchema,
    content: z.string().refine(value => !value.includes('\0'), 'File content must be text')
  }).strict(),
  z.object({
    type: z.literal('update'),
    path: safeProjectPathSchema,
    content: z.string().refine(value => !value.includes('\0'), 'File content must be text')
  }).strict(),
  z.object({
    type: z.literal('delete'),
    path: safeProjectPathSchema
  }).strict()
]);

export const generationResultSchema = z.object({
  message: z.string().trim().min(1),
  operations: z.array(fileOperationSchema),
  dependencies: dependencyMapSchema,
  devDependencies: dependencyMapSchema
}).strict();

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
  mode: z.enum(agentRunModes).default('create'),
  modelId: modelIdSchema.optional(),
  attachments: agentAttachmentsSchema.default([])
});

export const listAgentRunsQuerySchema = z.object({
  projectId: objectIdStringSchema,
  limit: z.coerce.number().int().min(1).max(30).default(30)
});

export const streamTokenRequestSchema = z.object({
  runId: objectIdStringSchema,
  lastEventId: z.coerce.number().int().nonnegative().optional()
});

export type CreateAgentRunRequest = z.infer<typeof createAgentRunRequestSchema>;
