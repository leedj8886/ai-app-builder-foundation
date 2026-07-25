import OpenAI from 'openai';
import type { ClientOptions } from 'openai';

type EnvLike = Record<string, string | undefined>;

export interface DeepSeekConfig {
  apiKey: string | undefined;
  baseURL: string;
  model: string;
}

type ClientFactory = (options: ClientOptions) => OpenAI;

const configurationError = (): Error & { code: string } =>
  Object.assign(
    new Error('DEEPSEEK_API_KEY is required'),
    { code: 'MODEL_CONFIGURATION_ERROR' }
  );

export const getDeepSeekConfig = (
  env: EnvLike = process.env
): DeepSeekConfig => ({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
});

export const createDeepSeekClient = (
  config: DeepSeekConfig,
  createClient: ClientFactory = options => new OpenAI(options)
): OpenAI => {
  if (!config.apiKey) {
    throw configurationError();
  }

  return createClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });
};
