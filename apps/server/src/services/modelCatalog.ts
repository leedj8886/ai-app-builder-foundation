import { z } from 'zod';

type EnvLike = Record<string, string | undefined>;

export const modelIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9_-]{1,63}$/,
    'Model id must use 2-64 lowercase letters, numbers, hyphens, or underscores'
  );

const modelDefinitionSchema = z.object({
  id: modelIdSchema,
  label: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(40),
  transport: z.literal('openai-compatible').default('openai-compatible'),
  model: z.string().trim().min(1).max(160),
  baseURL: z.string().url(),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  description: z.string().trim().max(240).optional()
}).strict();

export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

export interface PublicModelDefinition {
  id: string;
  label: string;
  provider: string;
  transport: 'openai-compatible';
  model: string;
  description?: string;
}

export interface ModelCatalog {
  defaultModelId: string;
  models: ModelDefinition[];
}

const configurationError = (message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code: 'MODEL_CATALOG_CONFIGURATION_ERROR' });

const legacyCatalog = (env: EnvLike): ModelCatalog => {
  const model = env.AGENT_MODEL || env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const id = env.AGENT_DEFAULT_MODEL_ID || 'deepseek-default';
  const definition = modelDefinitionSchema.safeParse({
    id,
    label: model,
    provider: 'deepseek',
    model,
    baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    description: 'Default DeepSeek-compatible generation model'
  });
  if (!definition.success) {
    throw configurationError(
      `Legacy model configuration is invalid: ${definition.error.issues[0]?.message ?? 'invalid value'}`
    );
  }

  return {
    defaultModelId: id,
    models: [definition.data]
  };
};

export const getModelCatalog = (
  env: EnvLike = process.env
): ModelCatalog => {
  if (!env.AGENT_MODELS_JSON?.trim()) {
    return legacyCatalog(env);
  }

  let input: unknown;
  try {
    input = JSON.parse(env.AGENT_MODELS_JSON);
  } catch {
    throw configurationError('AGENT_MODELS_JSON must be valid JSON');
  }

  const parsed = z.array(modelDefinitionSchema).min(1).safeParse(input);
  if (!parsed.success) {
    throw configurationError(
      `AGENT_MODELS_JSON is invalid: ${parsed.error.issues[0]?.message ?? 'invalid model entry'}`
    );
  }

  const ids = new Set<string>();
  for (const model of parsed.data) {
    if (ids.has(model.id)) {
      throw configurationError(`AGENT_MODELS_JSON contains duplicate id: ${model.id}`);
    }
    ids.add(model.id);
  }

  const defaultModelId = env.AGENT_DEFAULT_MODEL_ID || parsed.data[0].id;
  if (!ids.has(defaultModelId)) {
    throw configurationError(
      `AGENT_DEFAULT_MODEL_ID does not match an enabled model: ${defaultModelId}`
    );
  }

  return { defaultModelId, models: parsed.data };
};

export const findModelDefinition = (
  catalog: ModelCatalog,
  modelId: string
): ModelDefinition | undefined => catalog.models.find(model => model.id === modelId);

export const requireModelDefinition = (
  catalog: ModelCatalog,
  modelId: string
): ModelDefinition => {
  const model = findModelDefinition(catalog, modelId);
  if (!model) {
    throw Object.assign(new Error(`Model is not enabled: ${modelId}`), {
      statusCode: 400,
      code: 'MODEL_NOT_AVAILABLE'
    });
  }
  return model;
};

export const publicModelCatalog = (
  catalog: ModelCatalog
): { defaultModelId: string; models: PublicModelDefinition[] } => ({
  defaultModelId: catalog.defaultModelId,
  models: catalog.models.map(model => ({
    id: model.id,
    label: model.label,
    provider: model.provider,
    transport: model.transport,
    model: model.model,
    ...(model.description ? { description: model.description } : {})
  }))
});

export const resolveModelClientConfig = (
  catalog: ModelCatalog,
  modelId: string,
  env: EnvLike = process.env
): { apiKey: string | undefined; baseURL: string; model: string } => {
  const definition = requireModelDefinition(catalog, modelId);
  const apiKey = env[definition.apiKeyEnv];
  if (!apiKey) {
    throw Object.assign(
      new Error(`Model credential is not configured: ${modelId}`),
      { code: 'MODEL_CONFIGURATION_ERROR' }
    );
  }
  return {
    apiKey,
    baseURL: definition.baseURL,
    model: definition.model
  };
};
